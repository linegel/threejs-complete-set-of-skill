import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  RenderPipeline,
  Storage3DTexture,
  StorageTexture,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  Fn,
  abs,
  atan,
  cos,
  cross,
  dot,
  exp,
  float,
  fract,
  instanceIndex,
  length,
  log,
  max,
  min,
  mix,
  mrt,
  normalize,
  pass,
  pow,
  renderOutput,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  storageTexture,
  storageTexture3D,
  texture,
  texture3D,
  textureStore,
  uniform,
  uvec2,
  uvec3,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import {
  MAX_ABS_HG_G,
  createAtmosphereConfig,
  createProductSchedule,
  estimateAtmosphereMemoryBytes,
  validateAtmosphereConfig,
} from "./atmosphere-config.js";
import {
  AtmosphereInvalidationTracker,
  createDefaultAtmosphereRuntimeState,
  validateAtmosphereRuntimeState,
} from "./runtime-state.js";

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
  approximationProducts:
    "multiscatter, irradiance, and sky-view factories build bounded graphs but remain reference-ungated",
  aerialProducts:
    "one live-camera kernel owns each XY ray and cumulatively writes RGB inscattering-response and RGB optical-depth slices",
  submit:
    "renderer.compute(kernel) enqueues each real ComputeNode after renderer initialization; later GPU work is queue-ordered, but neither compute nor computeAsync is a CPU-visible GPU-completion fence",
  evidenceBoundary:
    "executed ComputeNode graph construction only; validation.js does not submit these kernels to a GPU",
});

export const PIPELINE_SCAFFOLD = Object.freeze({
  status: "implemented-runtime-structure-unaccepted",
  reason:
    "The browser host now binds a real scene pass, camera/body transforms, depth composite, controls, and invalidation graph; native readback/reference/timing/lifecycle evidence is still absent.",
  requiredWiring: [
    "configure scenePass.setMRT(...) before compile",
    "use getViewZNode only for perspective standard/reversed depth",
    "convert viewZ to metric ray distance for off-axis perspective rays",
    "compose Cscene*T_rgb+S_rgb",
    "set outputColorTransform=false only when renderOutput owns presentation",
  ],
});

const TRANSMITTANCE_SAMPLE_COUNT = 32;
const SKY_VIEW_SAMPLE_COUNT = 32;
const AERIAL_INTERVAL_SAMPLE_COUNT = 2;
const AERIAL_FROXEL_DEPTH_EXPONENT = 4.0;
const HG_DENOMINATOR_BASE_FLOOR = (1 - MAX_ABS_HG_G) ** 2;

function vec3FromArray(values) {
  return vec3(values[0], values[1], values[2]);
}

function createAtmosphereRuntimeInputs(config) {
  const state = createDefaultAtmosphereRuntimeState(config);
  return {
    state,
    cameraPositionWorldNode: uniform(
      new Vector3().fromArray(state.cameraPositionWorld),
      "vec3",
    ).setName("atmosphereCameraPositionWorld"),
    cameraPositionBodyKmNode: uniform(
      new Vector3().fromArray(state.cameraPositionBodyKm),
      "vec3",
    ).setName("atmosphereCameraPositionBodyKm"),
    inverseViewProjectionWorldNode: uniform(
      new Matrix4().fromArray(state.inverseViewProjectionWorld),
      "mat4",
    ).setName("atmosphereInverseViewProjectionWorld"),
    inverseViewProjectionBodyKmNode: uniform(
      new Matrix4().fromArray(state.inverseViewProjectionBodyKm),
      "mat4",
    ).setName("atmosphereInverseViewProjectionBodyKm"),
    worldToBodyNode: uniform(
      new Matrix4().fromArray(state.worldToBody),
      "mat4",
    ).setName("atmosphereWorldToBody"),
    worldToViewNode: uniform(
      new Matrix4().fromArray(state.worldToView),
      "mat4",
    ).setName("atmosphereWorldToView"),
    sunDirectionBodyNode: uniform(
      new Vector3().fromArray(state.sunDirectionBody),
      "vec3",
    ).setName("atmosphereSunDirectionBody"),
    solarNormalIrradianceNode: uniform(
      new Vector3().fromArray(state.solarNormalIrradiance),
      "vec3",
    ).setName("atmosphereSolarNormalIrradiance"),
    cameraRadiusKmNode: uniform(state.cameraRadiusKm).setName(
      "atmosphereCameraRadiusKm",
    ),
    localSunMuNode: uniform(state.localSunMu).setName("atmosphereLocalSunMu"),
    aerialFarKmNode: uniform(state.aerialFarKm).setName("atmosphereAerialFarKm"),
  };
}

function applyAtmosphereRuntimeState(inputs, candidate) {
  const state = validateAtmosphereRuntimeState(candidate);
  inputs.state = state;
  inputs.cameraPositionWorldNode.value.fromArray(state.cameraPositionWorld);
  inputs.cameraPositionBodyKmNode.value.fromArray(state.cameraPositionBodyKm);
  inputs.inverseViewProjectionWorldNode.value.fromArray(
    state.inverseViewProjectionWorld,
  );
  inputs.inverseViewProjectionBodyKmNode.value.fromArray(
    state.inverseViewProjectionBodyKm,
  );
  inputs.worldToBodyNode.value.fromArray(state.worldToBody);
  inputs.worldToViewNode.value.fromArray(state.worldToView);
  inputs.sunDirectionBodyNode.value.fromArray(state.sunDirectionBody).normalize();
  inputs.solarNormalIrradianceNode.value.fromArray(state.solarNormalIrradiance);
  inputs.cameraRadiusKmNode.value = state.cameraRadiusKm;
  inputs.localSunMuNode.value = state.localSunMu;
  inputs.aerialFarKmNode.value = state.aerialFarKm;
  return state;
}

/**
 * Derive the exact unjittered host-camera/body state consumed by sky-view,
 * aerial compute, final composition, depth, and ECEF diagnostics.
 */
export function deriveAtmosphereRuntimeState({
  camera,
  bodyWorldMatrix = new Matrix4(),
  sunDirectionWorld,
  config,
  viewport,
  aerialFarKm = null,
}) {
  if (!camera?.projectionMatrix || !camera?.matrixWorldInverse) {
    throw new TypeError("deriveAtmosphereRuntimeState requires a Three.js camera");
  }
  if (!bodyWorldMatrix?.isMatrix4) {
    throw new TypeError("bodyWorldMatrix must be a Matrix4");
  }
  if (!sunDirectionWorld?.isVector3 || sunDirectionWorld.lengthSq() === 0) {
    throw new TypeError("sunDirectionWorld must be a non-zero Vector3");
  }
  if (!Array.isArray(viewport) || viewport.length !== 2) {
    throw new TypeError("viewport must be [width,height]");
  }
  camera.updateWorldMatrix(true, false);
  const worldToBody = new Matrix4().copy(bodyWorldMatrix).invert();
  const cameraPositionWorld = camera.getWorldPosition(new Vector3());
  const cameraPositionBodyWorld = cameraPositionWorld.clone().applyMatrix4(worldToBody);
  const worldUnitsPerKm = config.renderUnitsPerMeter * 1000;
  const cameraPositionBodyKm = cameraPositionBodyWorld
    .clone()
    .divideScalar(worldUnitsPerKm);
  const cameraRadiusKm = cameraPositionBodyKm.length();
  const sunDirectionBody = sunDirectionWorld
    .clone()
    .transformDirection(worldToBody)
    .normalize();
  const bodyUp = cameraPositionBodyKm.clone().normalize();
  const localSunMu = bodyUp.dot(sunDirectionBody);
  const viewProjection = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const inverseViewProjectionWorld = viewProjection.clone().invert();
  const worldToBodyKm = new Matrix4()
    .makeScale(1 / worldUnitsPerKm, 1 / worldUnitsPerKm, 1 / worldUnitsPerKm)
    .multiply(worldToBody);
  const inverseViewProjectionBodyKm = worldToBodyKm
    .clone()
    .multiply(inverseViewProjectionWorld);
  const topRadiusKm = config.radiiMeters.top / 1000;
  const resolvedAerialFarKm = aerialFarKm ?? Math.max(
    160,
    Math.max(0, cameraRadiusKm - topRadiusKm) + 180,
  );
  return validateAtmosphereRuntimeState({
    modelRevision: config.modelRevision,
    tier: config.tier,
    cameraRadiusKm,
    localSunMu,
    cameraPositionWorld: cameraPositionWorld.toArray(),
    cameraPositionBodyKm: cameraPositionBodyKm.toArray(),
    inverseViewProjectionWorld: inverseViewProjectionWorld.toArray(),
    inverseViewProjectionBodyKm: inverseViewProjectionBodyKm.toArray(),
    worldToBody: worldToBody.toArray(),
    worldToView: camera.matrixWorldInverse.toArray(),
    sunDirectionBody: sunDirectionBody.toArray(),
    solarNormalIrradiance: config.solarIrradiance,
    aerialFarKm: resolvedAerialFarKm,
    viewport,
  });
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
  // For the validated |g| <= MAX_ABS_HG_G domain, the physical base is at
  // least (1 - MAX_ABS_HG_G)^2. Clamp only to that derived roundoff floor,
  // then exponentiate; clamping the already exponentiated denominator would
  // destroy the narrow normalized lobe near the allowed extreme.
  const positiveGBase = float(1.0)
    .sub(g)
    .mul(float(1.0).sub(g))
    .add(g.mul(2.0).mul(float(1.0).sub(cosTheta)));
  const negativeGBase = float(1.0)
    .add(g)
    .mul(float(1.0).add(g))
    .sub(g.mul(2.0).mul(float(1.0).add(cosTheta)));
  const mieDenominatorBase = max(
    select(g.greaterThanEqual(0.0), positiveGBase, negativeGBase),
    HG_DENOMINATOR_BASE_FLOOR,
  );
  const mieDenominator = pow(mieDenominatorBase, 1.5);
  const miePhase = float(1 / (4 * Math.PI))
    .mul(float(1.0).sub(g2))
    .div(mieDenominator);

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

function bottomIntersection(radiusKm, mu, bottomRadiusKm) {
  const discriminant = radiusKm
    .mul(radiusKm)
    .mul(mu.mul(mu).sub(1.0))
    .add(bottomRadiusKm.mul(bottomRadiusKm));
  const distance = radiusKm
    .mul(mu)
    .negate()
    .sub(sqrt(max(discriminant, 0.0)));
  return {
    distance,
    hit: discriminant.greaterThanEqual(0.0).and(distance.greaterThan(0.0)),
  };
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

function raySphereInterval(position, ray, radius) {
  const b = dot(position, ray);
  const c = dot(position, position).sub(radius.mul(radius));
  const discriminant = b.mul(b).sub(c);
  const root = sqrt(max(discriminant, 0.0));
  const near = b.negate().sub(root);
  const far = b.negate().add(root);
  const start = max(near, 0.0);
  return {
    start,
    end: far,
    hit: discriminant.greaterThanEqual(0.0).and(far.greaterThan(start)),
  };
}

function atmosphereRayInterval(position, ray, bottomRadiusKm, topRadiusKm) {
  const top = raySphereInterval(position, ray, topRadiusKm);
  const bottom = raySphereInterval(position, ray, bottomRadiusKm);
  const bottomInTopInterval = bottom.hit
    .and(bottom.start.greaterThanEqual(top.start))
    .and(bottom.start.lessThan(top.end));
  const end = select(bottomInTopInterval, bottom.start, top.end);
  return {
    start: top.start,
    end,
    hit: top.hit.and(end.greaterThan(top.start)),
    hitsGround: bottomInTopInterval,
  };
}

function transmittanceLookupUv(radiusKm, mu, config, dimensions) {
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const topRadiusKm = float(config.radiiMeters.top / 1000);
  const H = sqrt(
    topRadiusKm.mul(topRadiusKm).sub(bottomRadiusKm.mul(bottomRadiusKm)),
  );
  const rho = sqrt(
    max(radiusKm.mul(radiusKm).sub(bottomRadiusKm.mul(bottomRadiusKm)), 0.0),
  );
  const distanceToTop = transmittanceDistanceToTop(radiusKm, mu, topRadiusKm);
  const distanceMin = topRadiusKm.sub(radiusKm);
  const distanceMax = rho.add(H);
  const xMu = distanceToTop
    .sub(distanceMin)
    .div(max(distanceMax.sub(distanceMin), 1e-6))
    .clamp(0.0, 1.0);
  const xR = rho
    .div(H)
    .clamp(0.0, 1.0);
  // Parameter-domain endpoints are stored at texel centers. The half-texel
  // remap preserves those endpoint values while retaining bilinear filtering.
  return vec2(
    xMu.mul(dimensions.width - 1).add(0.5).div(dimensions.width),
    xR.mul(dimensions.height - 1).add(0.5).div(dimensions.height),
  );
}

function transmittancePhysicalCoordinates(cell, config, dimensions) {
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const topRadiusKm = float(config.radiiMeters.top / 1000);
  const H = sqrt(
    topRadiusKm.mul(topRadiusKm).sub(bottomRadiusKm.mul(bottomRadiusKm)),
  );
  const xMu = float(cell.x).div(dimensions.width - 1);
  const xR = float(cell.y).div(dimensions.height - 1);
  const rho = H.mul(xR);
  const radiusKm = sqrt(rho.mul(rho).add(bottomRadiusKm.mul(bottomRadiusKm)));
  const distanceMin = topRadiusKm.sub(radiusKm);
  const distanceMax = rho.add(H);
  const distanceToTop = mix(distanceMin, distanceMax, xMu);
  const numerator = topRadiusKm
    .mul(topRadiusKm)
    .sub(radiusKm.mul(radiusKm))
    .sub(distanceToTop.mul(distanceToTop));
  const mu = distanceToTop
    .lessThan(1e-6)
    .select(
      float(1.0),
      numerator.div(radiusKm.mul(distanceToTop).mul(2.0)).clamp(-1.0, 1.0),
    );
  return { radiusKm, mu, distanceToTop };
}

export function createTransmittanceLutComputeNode({ target, config, product }) {
  const dimensions = product.dimensions;

  const kernel = Fn(({ outputTex }) => {
    const cell = cell2DFromIndex(dimensions);
    const { radiusKm, mu, distanceToTop: topDistanceKm } =
      transmittancePhysicalCoordinates(cell, config, dimensions);
    const integrated = integrateTransmittance(
      radiusKm,
      mu,
      topDistanceKm,
      config,
      TRANSMITTANCE_SAMPLE_COUNT,
    );
    textureStore(outputTex, cell, vec4(integrated, 0.0)).toWriteOnly();
  });

  return kernel({ outputTex: target })
    .compute(dimensions.width * dimensions.height, product.workgroup)
    .setName("atmosphere:transmittance-lut");
}

function radiusAndSunCosineFromCell(cell, config, dimensions) {
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const topRadiusKm = float(config.radiiMeters.top / 1000);
  const H = sqrt(
    topRadiusKm.mul(topRadiusKm).sub(bottomRadiusKm.mul(bottomRadiusKm)),
  );
  const xR = float(cell.y).div(dimensions.height - 1);
  const rho = H.mul(xR);
  const radiusKm = sqrt(rho.mul(rho).add(bottomRadiusKm.mul(bottomRadiusKm)));
  const sunMu = float(cell.x)
    .div(dimensions.width - 1)
    .mul(2.0)
    .sub(1.0);
  return { radiusKm, sunMu };
}

function scatteringAlbedoAtAltitude(altitudeKm, config) {
  const density = densityTerms(altitudeKm, config);
  const sigmaS = vec3FromArray(config.rayleighScatteringPerKm)
    .mul(density.rayleigh)
    .add(vec3FromArray(config.mieScatteringPerKm).mul(density.mie));
  const sigmaT = extinctionPerKmAtAltitude(altitudeKm, config);
  return sigmaS.div(sigmaT.max(1e-6)).clamp(0.0, 1.0);
}

function scatteringCoefficientPerKmAtAltitude(altitudeKm, config) {
  const density = densityTerms(altitudeKm, config);
  return vec3FromArray(config.rayleighScatteringPerKm)
    .mul(density.rayleigh)
    .add(vec3FromArray(config.mieScatteringPerKm).mul(density.mie));
}

/**
 * Compact Hillaire-family multiple-scattering closure. The directional
 * quadrature estimates the escape probability from the current radius; the
 * geometric closure then sums orders 2..infinity while remaining bounded.
 * It is deliberately a response LUT, not another visible-pixel ray march.
 */
export function createMultiscatterLutComputeNode({
  target,
  transmittance,
  config,
  product,
  transmittanceProduct,
}) {
  const dimensions = product.dimensions;
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const quadratureSamples = 12;

  const kernel = Fn(({ outputTex, transmittanceTex }) => {
    const cell = cell2DFromIndex(dimensions);
    const { radiusKm, sunMu } = radiusAndSunCosineFromCell(
      cell,
      config,
      dimensions,
    );
    const altitudeKm = max(radiusKm.sub(bottomRadiusKm), 0.0);
    const albedo = scatteringAlbedoAtAltitude(altitudeKm, config);
    const meanEscape = vec3(0.0).toVar();

    for (let sample = 0; sample < quadratureSamples; sample += 1) {
      // Upper-hemisphere midpoint quadrature. Ground return is accounted for
      // separately through groundAlbedo, so it is not double counted here.
      const viewMu = float((sample + 0.5) / quadratureSamples);
      const uv = transmittanceLookupUv(
        radiusKm,
        viewMu,
        config,
        transmittanceProduct.dimensions,
      );
      meanEscape.assign(
        meanEscape.add(texture(transmittanceTex, uv).rgb.div(quadratureSamples)),
      );
    }

    const sunUv = transmittanceLookupUv(
      radiusKm,
      sunMu,
      config,
      transmittanceProduct.dimensions,
    );
    const sunT = texture(transmittanceTex, sunUv).rgb;
    const returnProbability = vec3(1.0)
      .sub(meanEscape)
      .mul(albedo)
      .add(float(config.groundAlbedo).mul(0.05))
      .clamp(0.0, 0.95);
    const firstOrderAvailable = vec3(1.0).sub(sunT).mul(albedo);
    const multiple = firstOrderAvailable
      .mul(returnProbability)
      .div(vec3(1.0).sub(returnProbability).max(1e-4))
      .mul(1 / (4 * Math.PI));
    const residual = returnProbability.x
      .max(returnProbability.y)
      .max(returnProbability.z);
    textureStore(outputTex, cell, vec4(multiple.max(0.0), residual)).toWriteOnly();
  });

  return kernel({ outputTex: target, transmittanceTex: transmittance })
    .compute(dimensions.width * dimensions.height, product.workgroup)
    .setName("atmosphere:multiscatter-closure-lut");
}

export function createIrradianceLutComputeNode({
  target,
  transmittance,
  multiscatter,
  config,
  product,
  transmittanceProduct,
  multiscatterProduct,
}) {
  const dimensions = product.dimensions;
  const quadratureSamples = 16;

  const kernel = Fn(({ outputTex, transmittanceTex, multiscatterTex }) => {
    const cell = cell2DFromIndex(dimensions);
    const { radiusKm, sunMu } = radiusAndSunCosineFromCell(
      cell,
      config,
      dimensions,
    );
    const irradiance = vec3(0.0).toVar();
    for (let sample = 0; sample < quadratureSamples; sample += 1) {
      const mu = float((sample + 0.5) / quadratureSamples);
      const tUv = transmittanceLookupUv(
        radiusKm,
        mu,
        config,
        transmittanceProduct.dimensions,
      );
      const msUv = vec2(
        sunMu.mul(0.5).add(0.5),
        float(cell.y).div(dimensions.height - 1),
      );
      const incident = texture(transmittanceTex, tUv).rgb
        .add(texture(multiscatterTex, msUv).rgb);
      irradiance.assign(
        irradiance.add(
          incident.mul(mu).mul((2 * Math.PI) / quadratureSamples),
        ),
      );
    }
    textureStore(outputTex, cell, vec4(irradiance.max(0.0), 1.0)).toWriteOnly();
  });

  return kernel({
    outputTex: target,
    transmittanceTex: transmittance,
    multiscatterTex: multiscatter,
  })
    .compute(dimensions.width * dimensions.height, product.workgroup)
    .setName("atmosphere:hemispherical-irradiance-lut");
}

export function createSkyViewLutComputeNode({
  target,
  transmittance,
  multiscatter,
  irradiance,
  config,
  product,
  transmittanceProduct,
  irradianceProduct,
  runtime,
}) {
  const dimensions = product.dimensions;
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const topRadiusKm = float(config.radiiMeters.top / 1000);
  const cameraRadiusKm = runtime.cameraRadiusKmNode;
  const horizonMu = sqrt(
    max(float(1.0).sub(bottomRadiusKm.div(cameraRadiusKm).pow(2.0)), 0.0),
  ).negate();
  const sunMuAtCamera = runtime.localSunMuNode.clamp(-1.0, 1.0);
  const sunDirection = normalize(
    vec3(
      sqrt(max(float(1.0).sub(sunMuAtCamera.mul(sunMuAtCamera)), 0.0)),
      sunMuAtCamera,
      0.0,
    ),
  );

  const kernel = Fn(
    ({ outputTex, transmittanceTex, multiscatterTex, irradianceTex }) => {
      const cell = cell2DFromIndex(dimensions);
      const x = float(cell.x).div(dimensions.width - 1);
      const y = float(cell.y).div(dimensions.height - 1);
      const upper = y.greaterThanEqual(0.5);
      const qUpper = y.mul(2.0).sub(1.0);
      const qLower = float(1.0).sub(y.mul(2.0));
      const viewMu = select(
        upper,
        horizonMu.add(float(1.0).sub(horizonMu).mul(qUpper.mul(qUpper))),
        horizonMu.sub(float(1.0).add(horizonMu).mul(qLower.mul(qLower))),
      );
      const phi = x.mul(2 * Math.PI).sub(Math.PI);
      const radial = sqrt(max(float(1.0).sub(viewMu.mul(viewMu)), 0.0));
      const viewRay = normalize(
        vec3(radial.mul(cos(phi)), viewMu, radial.mul(sin(phi))),
      );
      const cameraPosition = vec3(0.0, cameraRadiusKm, 0.0);
      const interval = atmosphereRayInterval(
        cameraPosition,
        viewRay,
        bottomRadiusKm,
        topRadiusKm,
      );
      const segmentKm = max(interval.end.sub(interval.start), 0.0);
      const stepKm = segmentKm.div(SKY_VIEW_SAMPLE_COUNT);
      const opticalDepth = vec3(0.0).toVar();
      const radianceResponse = vec3(0.0).toVar();

      // This is an actual radiometric line integral.  sigma_s*phase has units
      // km^-1 sr^-1, ds is km, and the result is relative radiance per sr per
      // unit authored solar normal irradiance.  Solar magnitude is applied
      // later by the host composite exactly once.
      for (let sample = 0; sample < SKY_VIEW_SAMPLE_COUNT; sample += 1) {
        const distanceKm = interval.start.add(stepKm.mul(sample + 0.5));
        const samplePosition = cameraPosition.add(viewRay.mul(distanceKm));
        const radiusKm = length(samplePosition);
        const altitudeKm = max(radiusKm.sub(bottomRadiusKm), 0.0);
        const extinction = extinctionPerKmAtAltitude(altitudeKm, config);
        const midpointOpticalDepth = opticalDepth.add(
          extinction.mul(stepKm).mul(0.5),
        );
        const viewTransmittance = exp(midpointOpticalDepth.negate()).clamp(0, 1);
        const normal = normalize(samplePosition);
        const sunMu = dot(normal, sunDirection);
        const sunBottomHit = bottomIntersection(radiusKm, sunMu, bottomRadiusKm);
        const sunUv = transmittanceLookupUv(
          radiusKm,
          sunMu,
          config,
          transmittanceProduct.dimensions,
        );
        const sunTransmittance = select(
          sunBottomHit.hit,
          vec3(0.0),
          texture(transmittanceTex, sunUv).rgb,
        );
        const directSource = scatteringPerKmAtAltitude(
          altitudeKm,
          config,
          viewRay,
          sunDirection,
        ).mul(sunTransmittance);
        const multiscatterUv = vec2(
          sunMu.mul(0.5).add(0.5),
          radiusKm
            .sub(bottomRadiusKm)
            .div(topRadiusKm.sub(bottomRadiusKm))
            .clamp(0, 1),
        );
        const multipleSource = texture(multiscatterTex, multiscatterUv).rgb
          .mul(scatteringCoefficientPerKmAtAltitude(altitudeKm, config));
        const inside = interval.hit
          .and(distanceKm.greaterThanEqual(interval.start))
          .and(distanceKm.lessThanEqual(interval.end));
        radianceResponse.assign(
          radianceResponse.add(
            select(
              inside,
              viewTransmittance.mul(directSource.add(multipleSource)).mul(stepKm),
              vec3(0.0),
            ),
          ),
        );
        opticalDepth.assign(
          opticalDepth.add(select(inside, extinction.mul(stepKm), vec3(0.0))),
        );
      }

      const groundPoint = cameraPosition.add(viewRay.mul(max(interval.end, 0.0)));
      const groundNormal = normalize(groundPoint);
      const groundSunMu = dot(groundNormal, sunDirection);
      const groundIrradianceUv = vec2(
        groundSunMu.mul(0.5).add(0.5),
        0.5 / irradianceProduct.dimensions.height,
      );
      const groundResponse = texture(irradianceTex, groundIrradianceUv).rgb
        .mul(config.groundAlbedo / Math.PI)
        .mul(exp(opticalDepth.negate()));
      const response = radianceResponse.add(
        select(interval.hitsGround, groundResponse, vec3(0.0)),
      );
      textureStore(
        outputTex,
        cell,
        vec4(response.max(0.0), select(interval.hitsGround, 0.0, 1.0)),
      ).toWriteOnly();
    },
  );

  return kernel({
    outputTex: target,
    transmittanceTex: transmittance,
    multiscatterTex: multiscatter,
    irradianceTex: irradiance,
  })
    .compute(dimensions.width * dimensions.height, product.workgroup)
    .setName("atmosphere:camera-sun-sky-view-lut");
}

export function createAerialFroxelComputeNode({
  inscatteringTarget,
  opticalDepthTarget,
  transmittance,
  multiscatter,
  config,
  product,
  transmittanceProduct,
  runtime,
}) {
  const dimensions = product.dimensions;
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const topRadiusKm = float(config.radiiMeters.top / 1000);
  const sunDirection = normalize(runtime.sunDirectionBodyNode);

  const kernel = Fn(
    ({ inscatteringTex, opticalDepthTex, transmittanceTex, multiscatterTex }) => {
      const cell = cell2DFromIndex(dimensions);
      const uv = vec2(cell)
        .add(0.5)
        .div(vec2(dimensions.width, dimensions.height));
      const clipFar = vec4(
        uv.x.mul(2.0).sub(1.0),
        float(1.0).sub(uv.y.mul(2.0)),
        1.0,
        1.0,
      );
      const cameraPosition = runtime.cameraPositionBodyKmNode;
      const bodyFarH = runtime.inverseViewProjectionBodyKmNode.mul(clipFar);
      const bodyFarKm = bodyFarH.xyz.div(bodyFarH.w);
      const rayBody = normalize(bodyFarKm.sub(cameraPosition));
      const interval = atmosphereRayInterval(
        cameraPosition,
        rayBody,
        bottomRadiusKm,
        topRadiusKm,
      );
      const depthExponent = float(AERIAL_FROXEL_DEPTH_EXPONENT);
      const denominator = exp(depthExponent).sub(1.0);
      const previousDepthKm = float(0.0).toVar();
      const opticalDepth = vec3(0.0).toVar();
      const inscatteringResponse = vec3(0.0).toVar();

      // One invocation owns one XY ray and advances monotonically through Z.
      // Every stored froxel is cumulative from the same camera origin.  This
      // eliminates the old O(depth^2) repeated-prefix integration and makes
      // inscattering/optical-depth slice freshness atomic.
      for (let slice = 0; slice < dimensions.depth; slice += 1) {
        const z = float(slice).div(dimensions.depth - 1);
        const currentDepthKm = runtime.aerialFarKmNode.mul(
          exp(depthExponent.mul(z)).sub(1.0).div(denominator),
        );
        const intervalLengthKm = currentDepthKm.sub(previousDepthKm);

        for (
          let sample = 0;
          sample < AERIAL_INTERVAL_SAMPLE_COUNT;
          sample += 1
        ) {
          const fraction = (sample + 0.5) / AERIAL_INTERVAL_SAMPLE_COUNT;
          const distanceKm = previousDepthKm.add(intervalLengthKm.mul(fraction));
          const samplePosition = cameraPosition.add(rayBody.mul(distanceKm));
          const radiusKm = length(samplePosition);
          const altitudeKm = max(radiusKm.sub(bottomRadiusKm), 0.0);
          const inside = interval.hit
            .and(distanceKm.greaterThanEqual(interval.start))
            .and(distanceKm.lessThanEqual(interval.end));
          const extinction = extinctionPerKmAtAltitude(altitudeKm, config);
          const stepKm = intervalLengthKm.div(AERIAL_INTERVAL_SAMPLE_COUNT);
          const opticalDepthAtMidpoint = opticalDepth.add(
            select(inside, extinction.mul(stepKm).mul(0.5), vec3(0.0)),
          );
          const normal = normalize(samplePosition);
          const sunMu = dot(normal, sunDirection);
          const sunBottomHit = bottomIntersection(radiusKm, sunMu, bottomRadiusKm);
          const transmittanceUv = transmittanceLookupUv(
            radiusKm,
            sunMu,
            config,
            transmittanceProduct.dimensions,
          );
          const sunTransmittance = select(
            sunBottomHit.hit,
            vec3(0.0),
            texture(transmittanceTex, transmittanceUv).rgb,
          );
          const directSource = scatteringPerKmAtAltitude(
            altitudeKm,
            config,
            rayBody,
            sunDirection,
          ).mul(sunTransmittance);
          const multiscatterUv = vec2(
            sunMu.mul(0.5).add(0.5),
            radiusKm
              .sub(bottomRadiusKm)
              .div(topRadiusKm.sub(bottomRadiusKm))
              .clamp(0.0, 1.0),
          );
          const multipleSource = texture(multiscatterTex, multiscatterUv).rgb
            .mul(scatteringCoefficientPerKmAtAltitude(altitudeKm, config));
          const viewTransmittance = exp(opticalDepthAtMidpoint.negate()).clamp(0, 1);
          inscatteringResponse.assign(
            inscatteringResponse.add(
              select(
                inside,
                viewTransmittance
                  .mul(directSource.add(multipleSource))
                  .mul(stepKm),
                vec3(0.0),
              ),
            ),
          );
          opticalDepth.assign(
            opticalDepth.add(select(inside, extinction.mul(stepKm), vec3(0.0))),
          );
        }

        const storageCell = uvec3(cell.x, cell.y, slice);
        storageTexture3D(inscatteringTex)
          .store(
            storageCell,
            vec4(
              inscatteringResponse.max(0.0),
              select(
                interval.hit.and(currentDepthKm.greaterThan(interval.start)),
                1.0,
                0.0,
              ),
            ),
          )
          .toWriteOnly();
        storageTexture3D(opticalDepthTex)
          .store(storageCell, vec4(opticalDepth.max(0.0), currentDepthKm))
          .toWriteOnly();
        previousDepthKm.assign(currentDepthKm);
      }
    },
  );

  return kernel({
    inscatteringTex: inscatteringTarget,
    opticalDepthTex: opticalDepthTarget,
    transmittanceTex: transmittance,
    multiscatterTex: multiscatter,
  })
    .compute(dimensions.width * dimensions.height, product.workgroup)
    .setName("atmosphere:aerial-cumulative-xy-rays");
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
  textureResource.minFilter = LinearFilter;
  textureResource.magFilter = LinearFilter;
  textureResource.wrapS = product.id === "sky-view"
    ? RepeatWrapping
    : ClampToEdgeWrapping;
  textureResource.wrapT = ClampToEdgeWrapping;
  if ("wrapR" in textureResource) textureResource.wrapR = ClampToEdgeWrapping;
  textureResource.generateMipmaps = false;
  if ("mipmapsAutoUpdate" in textureResource) {
    textureResource.mipmapsAutoUpdate = false;
  }
  return textureResource;
}

function skyViewLookupUv({
  viewRayBodyNode,
  cameraPositionBodyKmNode,
  sunDirectionBodyNode,
  config,
  dimensions,
}) {
  const up = normalize(cameraPositionBodyKmNode);
  const radiusKm = length(cameraPositionBodyKmNode);
  const bottomRadiusKm = float(config.radiiMeters.bottom / 1000);
  const horizonMu = sqrt(
    max(float(1.0).sub(bottomRadiusKm.div(radiusKm).pow(2.0)), 0.0),
  ).negate();
  const sunHorizontal = sunDirectionBodyNode.sub(
    up.mul(dot(sunDirectionBodyNode, up)),
  );
  const sunHorizontalLength = length(sunHorizontal);
  const fallbackAxis = select(
    abs(up.y).lessThan(0.99),
    vec3(0.0, 1.0, 0.0),
    vec3(1.0, 0.0, 0.0),
  );
  const fallbackTangent = normalize(cross(fallbackAxis, up));
  const sunTangent = select(
    sunHorizontalLength.greaterThan(1e-6),
    sunHorizontal.div(max(sunHorizontalLength, 1e-6)),
    fallbackTangent,
  );
  const bitangent = normalize(cross(up, sunTangent));
  const viewMu = dot(viewRayBodyNode, up).clamp(-1.0, 1.0);
  const phi = atan(
    dot(viewRayBodyNode, bitangent),
    dot(viewRayBodyNode, sunTangent),
  );
  const x = fract(phi.div(2 * Math.PI).add(0.5));
  const skySide = viewMu.greaterThanEqual(horizonMu);
  const qSky = viewMu
    .sub(horizonMu)
    .div(max(float(1.0).sub(horizonMu), 1e-6))
    .clamp(0.0, 1.0);
  const qGround = horizonMu
    .sub(viewMu)
    .div(max(float(1.0).add(horizonMu), 1e-6))
    .clamp(0.0, 1.0);
  const y = select(
    skySide,
    float(0.5).add(sqrt(qSky).mul(0.5)),
    float(0.5).sub(sqrt(qGround).mul(0.5)),
  );
  return vec2(
    x.mul(dimensions.width - 1).add(0.5).div(dimensions.width),
    y.mul(dimensions.height - 1).add(0.5).div(dimensions.height),
  );
}

/**
 * Reusable atmosphere stage for host-owned RenderPipelines. It allocates no
 * renderer, pass, or output transform. `depthFractionNode` is the exponential
 * depth parameter in [0,1], derived from the host's real scene depth.
 */
export function createAtmosphereCompositeNode({
  sceneColorNode,
  depthFractionNode,
  surfaceCoverageNode,
  resources,
  runtime,
  config,
  viewRayBodyNode,
  uvNode = screenUV,
}) {
  if (
    !sceneColorNode ||
    !depthFractionNode ||
    !surfaceCoverageNode ||
    !resources ||
    !runtime ||
    !config ||
    !viewRayBodyNode
  ) {
    throw new Error(
      "atmosphere composite requires host color/depth/coverage, body ray, runtime state, config, and LUT resources",
    );
  }
  const transmittanceLut =
    resources.get?.("transmittance") ?? resources.transmittance;
  const skyView = resources.get?.("sky-view") ?? resources.skyView;
  const aerialInscattering =
    resources.get?.("aerial-inscattering") ?? resources.aerialInscattering;
  const aerialOpticalDepth =
    resources.get?.("aerial-optical-depth") ?? resources.aerialOpticalDepth;
  if (!transmittanceLut || !skyView || !aerialInscattering || !aerialOpticalDepth) {
    throw new Error(
      "atmosphere composite is missing transmittance, sky-view, or aerial products",
    );
  }
  const productById = new Map(config.products.map((product) => [product.id, product]));
  const skyViewProduct = productById.get("sky-view");
  const transmittanceProduct = productById.get("transmittance");
  const aerialProduct = productById.get("aerial-inscattering");
  const z = depthFractionNode
    .clamp(0, 1)
    .mul(aerialProduct.dimensions.depth - 1)
    .add(0.5)
    .div(aerialProduct.dimensions.depth);
  const froxelUv = vec3(uvNode, z);
  const solar = runtime.solarNormalIrradianceNode;
  const inscatteringResponse = texture3D(aerialInscattering, froxelUv).rgb;
  const opticalDepth = texture3D(aerialOpticalDepth, froxelUv).rgb.max(0);
  const transmittance = exp(opticalDepth.negate()).clamp(0, 1);
  const surface = vec4(
    sceneColorNode.rgb
      .mul(transmittance)
      .add(inscatteringResponse.mul(solar)),
    sceneColorNode.a,
  );
  const skyUv = skyViewLookupUv({
    viewRayBodyNode,
    cameraPositionBodyKmNode: runtime.cameraPositionBodyKmNode,
    sunDirectionBodyNode: runtime.sunDirectionBodyNode,
    config,
    dimensions: skyViewProduct.dimensions,
  });
  const skyResponse = texture(skyView, skyUv).rgb;
  const cameraInsideAtmosphere = runtime.cameraRadiusKmNode.lessThanEqual(
    config.radiiMeters.top / 1000,
  );
  const sunTransmittanceUv = transmittanceLookupUv(
    min(runtime.cameraRadiusKmNode, config.radiiMeters.top / 1000),
    runtime.localSunMuNode,
    config,
    transmittanceProduct.dimensions,
  );
  const sunTransmittance = select(
    cameraInsideAtmosphere,
    texture(transmittanceLut, sunTransmittanceUv).rgb,
    vec3(1.0),
  );
  const cameraUp = normalize(runtime.cameraPositionBodyKmNode);
  const horizonMu = sqrt(
    max(
      float(1.0).sub(
        float(config.radiiMeters.bottom / 1000)
          .div(runtime.cameraRadiusKmNode)
          .pow(2.0),
      ),
      0.0,
    ),
  ).negate();
  const sunVisible = runtime.localSunMuNode.greaterThan(horizonMu);
  const sunCosine = dot(viewRayBodyNode, runtime.sunDirectionBodyNode);
  const disc = smoothstep(
    Math.cos(config.sunAngularRadius * 1.12),
    Math.cos(config.sunAngularRadius * 0.88),
    sunCosine,
  ).mul(select(sunVisible, 1.0, 0.0));
  const discRadiancePerNormalIrradiance =
    1 / (Math.PI * Math.sin(config.sunAngularRadius) ** 2);
  const sunDisc = solar
    .mul(sunTransmittance)
    .mul(disc)
    .mul(discRadiancePerNormalIrradiance);
  const sky = vec4(skyResponse.mul(solar).add(sunDisc), 1.0);
  return select(surfaceCoverageNode, surface, sky);
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
    submitTarget:
      "renderer.compute after initialization; not called by validation.js and not a GPU-completion fence",
    write:
      product.kind === "Storage3DTexture"
        ? "storageTexture3D(texture).store(xyz, RGBA16F)"
        : "textureStore(StorageTexture, xy, RGBA16F)",
    sample:
      product.kind === "Storage3DTexture"
        ? "texture3D(aerialFroxel)"
        : "texture(lut)",
    dispatch: product.dispatch,
    invocationCount: product.invocationCount,
    workgroupInvocations: product.workgroupInvocations,
    flattenedWorkgroupCount: product.flattenedWorkgroupCount,
    dispatchModel: product.dispatchModel,
    kernelId: product.kernelId,
    dispatchAccounting: product.dispatchAccounting,
    workgroup: product.workgroup,
    invalidation: product.invalidation,
    cadence: product.cadence,
    implementationStatus: product.implementationStatus,
    constructedBy:
      product.id === "aerial-optical-depth"
        ? "shared aerial-products ComputeNode"
        : product.implementationStatus.startsWith("kernel-implemented")
          ? "Phase 1 ComputeNode factory"
          : null,
  }));
}

export function createAtmosphereComputeKernels(
  resources,
  config,
  products,
  runtime = createAtmosphereRuntimeInputs(config),
) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const transmittanceProduct = productById.get("transmittance");
  const multiscatterProduct = productById.get("multiscatter");
  const irradianceProduct = productById.get("irradiance");
  const skyViewProduct = productById.get("sky-view");
  const aerialInscatteringProduct = productById.get("aerial-inscattering");
  const transmittance = resources.get("transmittance");
  const multiscatter = resources.get("multiscatter");
  const irradiance = resources.get("irradiance");
  const skyView = resources.get("sky-view");
  const aerialInscattering = resources.get("aerial-inscattering");
  const aerialOpticalDepth = resources.get("aerial-optical-depth");

  if (
    !transmittance ||
    !multiscatter ||
    !irradiance ||
    !skyView ||
    !aerialInscattering ||
    !aerialOpticalDepth
  ) {
    throw new Error(
      "createAtmosphereComputeKernels requires every scheduled atmosphere storage resource",
    );
  }

  return {
    transmittance: createTransmittanceLutComputeNode({
      target: transmittance,
      config,
      product: transmittanceProduct,
    }),
    multiscatter: createMultiscatterLutComputeNode({
      target: multiscatter,
      transmittance,
      config,
      product: multiscatterProduct,
      transmittanceProduct,
    }),
    irradiance: createIrradianceLutComputeNode({
      target: irradiance,
      transmittance,
      multiscatter,
      config,
      product: irradianceProduct,
      transmittanceProduct,
      multiscatterProduct,
    }),
    skyView: createSkyViewLutComputeNode({
      target: skyView,
      transmittance,
      multiscatter,
      irradiance,
      config,
      product: skyViewProduct,
      transmittanceProduct,
      irradianceProduct,
      runtime,
    }),
    aerialProducts: createAerialFroxelComputeNode({
      inscatteringTarget: aerialInscattering,
      opticalDepthTarget: aerialOpticalDepth,
      transmittance,
      multiscatter,
      config,
      product: aerialInscatteringProduct,
      transmittanceProduct,
      runtime,
    }),
    executionOrder: [
      "transmittance",
      "multiscatter",
      "irradiance",
      "skyView",
      "aerialProducts",
    ],
    limitations: [
      "The compact multiscatter, irradiance, and sky-view graphs contain authored closure/quadrature choices and are not accepted until reference-radiance and energy gates pass.",
      "Browser acceptance remains incomplete until the live camera-bound kernels and final depth composite have native-WebGPU readback evidence.",
    ],
  };
}

export function createAtmospherePipelineContract() {
  return {
    renderer: "WebGPURenderer",
    rendererInit: "await renderer.init()",
    capabilityGate: "renderer.backend.isWebGPUBackend",
    backendPolicy: "native WebGPU required; no alternate-renderer branch",
    pipeline: "RenderPipeline",
    scenePass: "pass(scene, camera)",
    gbuffer: "mrt({ color, depth, normal, velocity }) only when the host needs shared signals",
    depthOwner:
      "host scene pass: browser lab samples actual depth, uses getViewZNode for perspective, and converts off-axis view Z to metric ray distance",
    viewportBinding:
      "live unjittered inverse view-projection, body transform, camera pose, and viewport feed the aerial kernel",
    output:
      "renderOutput owns final presentation; RenderPipeline.outputColorTransform is false",
    outputColorTransform: false,
    materialIrradiance:
      "disabled until a host MeshStandardNodeMaterial or MeshPhysicalNodeMaterial lighting integration consumes the validated irradiance LUT",
    implementationStatus:
      "implemented-native-webgpu-runtime-structure; acceptance remains incomplete until browser readback, reference-radiance, timing, and lifecycle evidence pass",
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
    this.runtime = createAtmosphereRuntimeInputs(config);
    this.invalidation = new AtmosphereInvalidationTracker();
    this.invalidation.configure(this.runtime.state, "initialization");
    this.kernels = null;
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
        "threejs-sky-atmosphere-and-haze requires a native WebGPU backend.",
      );
    }
    this.backendTier = "native-webgpu";
    return this;
  }

  createResourcePlan() {
    return {
      renderer: WEBGPU_IMPORT_CONTRACT,
      tsl: TSL_IMPORT_CONTRACT,
      products: this.products,
      authoredSchedulePayloadBytes: estimateAtmosphereMemoryBytes(this.config.tier),
      phase1KernelResourcePayloadBytes: this.products
        .filter((product) => product.implementationStatus.startsWith("kernel-implemented"))
        .reduce((total, product) => total + product.byteLength, 0),
      phase1FlattenedDispatchGroups: Array.from(
        new Map(
          this.products
            .filter((product) => product.implementationStatus.startsWith("kernel-implemented"))
            .map((product) => [product.kernelId, product]),
        ).values(),
      ).reduce((total, product) => total + product.flattenedWorkgroupCount, 0),
      evidenceStatus:
        "derived payload bytes and r185 flattened group counts only; not peak live memory, GPU execution, completion, or performance evidence",
      runtimeBinding: {
        camera: "live host camera world position and unjittered inverse view-projection",
        body: "live world-to-body transform and camera body-space position",
        sun: "live body-space direction; normal irradiance magnitude factored out",
        aerialTopology: "one cumulative invocation per XY ray",
      },
      invalidation: this.invalidation.describe(),
    };
  }

  createStorageResources({ includeDescriptorOnly = false } = {}) {
    if (this.resources.size > 0) return this.resources;
    for (const product of this.products) {
      if (
        !includeDescriptorOnly &&
        !product.implementationStatus.startsWith("kernel-implemented")
      ) {
        continue;
      }
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
    this.kernels ??= createAtmosphereComputeKernels(
      this.resources,
      this.config,
      this.products,
      this.runtime,
    );
    return this.kernels;
  }

  configureRuntimeState(state, cause = "runtime-control") {
    const resolved = this.invalidation.configure(state, cause);
    applyAtmosphereRuntimeState(this.runtime, resolved.state);
    return resolved;
  }

  computeAtmosphereLuts(renderer, { forceAll = false, cause = "forced-refresh" } = {}) {
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("Atmosphere compute submission requires an initialized native WebGPU backend");
    }
    const kernels = this.createComputeKernels();
    if (forceAll) this.invalidation.markAllDirty(cause);
    const update = this.invalidation.consume();
    for (const product of update.dirty) renderer.compute(kernels[product]);
    return {
      ...kernels,
      submitted: update.dirty,
      reasons: update.reasons,
      submissionStatus:
        "queued on initialized renderer; no GPU-completion or readback fence is implied",
    };
  }

  createPassGraph() {
    return createAtmospherePipelineContract();
  }

  resize(width, height) {
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
      throw new Error("viewport width and height must be positive integers");
    }
    this.size = { width, height };
    const state = {
      ...this.runtime.state,
      viewport: [width, height],
    };
    const invalidation = this.configureRuntimeState(state, "viewport-resize");
    return {
      resourceResize: "not-applicable",
      reason:
        "authored LUT dimensions remain fixed inside a tier; viewport/aspect invalidates the live aerial ray product",
      viewport: { ...this.size },
      dirtyProducts: invalidation.dirty,
    };
  }

  dispose() {
    for (const textureResource of this.resources.values()) {
      textureResource.dispose();
      this.disposeCounters.storageTextures += 1;
    }
    this.resources.clear();
    this.kernels = null;
    if (this.pipeline) {
      this.pipeline.dispose?.();
      this.disposeCounters.pipelines += 1;
    }
  }
}

/** Reusable host stage. The caller retains renderer, pass, tone, and output ownership. */
export function createAtmosphereStage({ config = createAtmosphereConfig() } = {}) {
  const system = new WebGPULutAtmosphere({ config });
  return {
    system,
    initialize: (renderer) => system.initialize(renderer),
    createResources: () => system.createStorageResources(),
    createKernels: () => system.createComputeKernels(),
    configureRuntimeState: (state, cause) =>
      system.configureRuntimeState(state, cause),
    dispatch: (renderer, options) => system.computeAtmosphereLuts(renderer, options),
    dispatchDirty: (renderer) => system.computeAtmosphereLuts(renderer),
    describeUpdates: () => system.invalidation.describe(),
    describePipeline: () => system.createPassGraph(),
    describeResources: () => system.createResourcePlan(),
    dispose: () => system.dispose(),
  };
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
