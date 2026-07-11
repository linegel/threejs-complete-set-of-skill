import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NoColorSpace,
  PerspectiveCamera,
  RGBAFormat,
  RepeatWrapping,
  Vector3,
} from "three/webgpu";

import {
  MAX_ABS_HG_G,
  QUALITY_TIERS,
  UNIT_CONVERSION_FIXTURES,
  createAtmosphereConfig,
  createProductSchedule,
  renderUnitsToAtmosphereMeters,
  validateAtmosphereConfig,
  validateAtmosphereManifestCompatibility,
} from "./atmosphere-config.js";
import {
  classifyDepthSample,
  logarithmicDepthToViewZ,
  logarithmicViewZToDepth,
  orthographicDepthToViewZ,
  orthographicViewZToDepth,
  perspectiveDepthToViewZ,
  perspectiveViewZToMetricRayDistance,
  perspectiveViewZToDepth,
  resolveNearestSurfaceDepth,
  reversedPerspectiveDepthToViewZ,
  reversedPerspectiveViewZToDepth,
} from "./depth-contract.js";
import {
  createAtmosphereLutTextures,
  validateAtmosphereLuts,
} from "./load-atmosphere-luts.js";
import {
  exponentialFroxelDepth,
  ecefToGeodetic,
  geodeticToEcef,
  henyeyGreensteinPhase,
  homogeneousRadianceResponse,
  homogeneousTransmittance,
  integrateCumulativeAerialRay,
  normalize,
  rayleighPhase,
  rayEllipsoidInterval,
  segmentOutsideAtmosphere,
  segmentOutsideAtmosphereOldExpression,
  topAtmosphereIntersection,
  topAtmosphereIntersectionOldSafeSqrt,
  transmittancePhysicalToUnit,
  transmittanceUnitToPhysical,
} from "./atmosphere-math.js";
import {
  PIPELINE_SCAFFOLD,
  TSL_COMPUTE_SCAFFOLD,
  WebGPULutAtmosphere,
  createAtmosphereStage,
  deriveAtmosphereRuntimeState,
} from "./webgpu-lut-atmosphere.js";
import {
  createDefaultAtmosphereRuntimeState,
  resolveAtmosphereDirtyProducts,
} from "./runtime-state.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const assetDir = resolve(root, "assets/lut-aerial-perspective");
const manifestPath = resolve(assetDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

export const VALIDATION_SCOPE = Object.freeze({
  evidenceLevel: "node-structural-and-cpu-equation-only",
  proves: [
    "imported asset integrity/layout",
    "manifest/live-model metadata compatibility",
    "model/unit invariants",
    "CPU spherical intersection/LUT/depth/MSAA-resolve/phase equations",
    "TSL ComputeNode graph construction",
    "descriptor claim boundaries",
    "resource allocation/disposal metadata",
  ],
  doesNotProve: [
    "GPU initialization, submission, or readback",
    "GPU execution or numeric correctness of multiscatter, irradiance, or sky-view transport",
    "scene depth capture or aerial composition",
    "reference radiance/error or energy convergence",
    "image quality, frame time, or peak live memory",
  ],
});

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function bufferFor(texture) {
  return readFileSync(resolve(assetDir, texture.path));
}

function assertManifestAssets() {
  for (const [name, texture] of Object.entries(manifest.textures)) {
    const path = resolve(assetDir, texture.path);
    assert.equal(statSync(path).size, texture.byteLength, `${name} byteLength`);
    assert.equal(sha256(path), texture.sha256, `${name} sha256`);
  }
}

function expectInvalidConfig(config, expectedText) {
  const result = validateAtmosphereConfig(config);
  assert.equal(result.ok, false, "config should be invalid");
  assert(
    result.errors.some((error) => error.includes(expectedText)),
    `expected "${expectedText}", got ${result.errors.join("; ")}`,
  );
}

function assertClose(actual, expected, tolerance, label) {
  const error = Math.abs(actual - expected);
  assert(error <= tolerance, `${label}: error ${error} exceeds ${tolerance}`);
  return error;
}

function assertTextureUploadPolicy(textures) {
  for (const [name, texture] of Object.entries(textures)) {
    assert.equal(texture.format, RGBAFormat, `${name} format`);
    assert.equal(texture.type, HalfFloatType, `${name} type`);
    assert.equal(texture.minFilter, LinearFilter, `${name} minFilter`);
    assert.equal(texture.magFilter, LinearFilter, `${name} magFilter`);
    assert.equal(texture.wrapS, ClampToEdgeWrapping, `${name} wrapS`);
    assert.equal(texture.wrapT, ClampToEdgeWrapping, `${name} wrapT`);
    if ("wrapR" in texture) {
      assert.equal(texture.wrapR, ClampToEdgeWrapping, `${name} wrapR`);
    }
    assert.equal(texture.colorSpace, NoColorSpace, `${name} colorSpace`);
    assert.equal(texture.generateMipmaps, false, `${name} mipmaps`);
    assert.equal(texture.unpackAlignment, 1, `${name} unpackAlignment`);
    assert(texture.version > 0, `${name} needsUpdate version`);
    assert(texture.source.version > 0, `${name} source needsUpdate version`);
  }
}

function densityLayerAtKm(altitudeKm, layer) {
  return Math.min(
    Math.max(
      layer.expTerm * Math.exp(layer.expScalePerKm * altitudeKm) +
        layer.linearTermPerKm * altitudeKm +
        layer.constantTerm,
      0,
    ),
    1,
  );
}

function profileDensityAtKm(altitudeKm, layers) {
  if (layers.length === 1) return densityLayerAtKm(altitudeKm, layers[0]);
  const firstWidthKm = layers[0].widthMeters / 1000;
  return densityLayerAtKm(
    altitudeKm,
    altitudeKm < firstWidthKm ? layers[0] : layers[1],
  );
}

function extinctionAtAltitudeKm(altitudeKm, atmosphereConfig) {
  const rayleighDensity = profileDensityAtKm(
    altitudeKm,
    atmosphereConfig.densityProfiles.rayleighDensity,
  );
  const mieDensity = profileDensityAtKm(
    altitudeKm,
    atmosphereConfig.densityProfiles.mieDensity,
  );
  const absorptionDensity = profileDensityAtKm(
    altitudeKm,
    atmosphereConfig.densityProfiles.absorptionDensity,
  );

  return [0, 1, 2].map(
    (channel) =>
      atmosphereConfig.rayleighScatteringPerKm[channel] * rayleighDensity +
      atmosphereConfig.mieExtinctionPerKm[channel] * mieDensity +
      atmosphereConfig.absorptionExtinctionPerKm[channel] * absorptionDensity,
  );
}

function distanceToTopAtmosphereKm(radiusKm, mu, topRadiusKm) {
  const discriminant =
    radiusKm * radiusKm * (mu * mu - 1) + topRadiusKm * topRadiusKm;
  return -radiusKm * mu + Math.sqrt(Math.max(discriminant, 0));
}

function integrateTransmittanceMirror({
  radiusKm,
  mu,
  pathLengthKm,
  atmosphereConfig,
  samples = 256,
}) {
  const bottomRadiusKm = atmosphereConfig.radiiMeters.bottom / 1000;
  const horizontal = Math.sqrt(Math.max(1 - mu * mu, 0));
  const ray = normalize([horizontal, mu, 0]);
  const stepKm = pathLengthKm / samples;
  const opticalDepth = [0, 0, 0];

  for (let sample = 0; sample < samples; sample += 1) {
    const distanceKm = stepKm * (sample + 0.5);
    const position = [
      ray[0] * distanceKm,
      radiusKm + ray[1] * distanceKm,
      ray[2] * distanceKm,
    ];
    const altitudeKm = Math.max(Math.hypot(...position) - bottomRadiusKm, 0);
    const extinction = extinctionAtAltitudeKm(altitudeKm, atmosphereConfig);
    for (let channel = 0; channel < 3; channel += 1) {
      opticalDepth[channel] += extinction[channel] * stepKm;
    }
  }

  return opticalDepth.map((depth) => Math.exp(-depth));
}

function assertTransmittanceMirrorInvariants(atmosphereConfig) {
  const bottomRadiusKm = atmosphereConfig.radiiMeters.bottom / 1000;
  const topRadiusKm = atmosphereConfig.radiiMeters.top / 1000;
  const fixtureRays = [
    { radiusKm: bottomRadiusKm + 1, mu: 1.0 },
    { radiusKm: bottomRadiusKm + 5, mu: 0.35 },
    { radiusKm: bottomRadiusKm + 20, mu: 0.8 },
  ];

  for (const fixture of fixtureRays) {
    const topDistanceKm = distanceToTopAtmosphereKm(
      fixture.radiusKm,
      fixture.mu,
      topRadiusKm,
    );
    const shortPath = integrateTransmittanceMirror({
      ...fixture,
      pathLengthKm: topDistanceKm * 0.25,
      atmosphereConfig,
    });
    const longPath = integrateTransmittanceMirror({
      ...fixture,
      pathLengthKm: topDistanceKm,
      atmosphereConfig,
    });

    for (let channel = 0; channel < 3; channel += 1) {
      assert(
        shortPath[channel] > 0 && shortPath[channel] <= 1,
        `short transmittance channel ${channel} must be in (0, 1]`,
      );
      assert(
        longPath[channel] > 0 && longPath[channel] <= 1,
        `long transmittance channel ${channel} must be in (0, 1]`,
      );
      assert(
        longPath[channel] <= shortPath[channel],
        `transmittance channel ${channel} must decrease with path length`,
      );
    }
  }
}

function assertLutParameterizationRoundTrip(atmosphereConfig) {
  const bottomRadius = atmosphereConfig.radiiMeters.bottom / 1000;
  const topRadius = atmosphereConfig.radiiMeters.top / 1000;
  let maxMuError = 0;
  let maxRadiusError = 0;
  for (let y = 0; y <= 32; y += 1) {
    for (let x = 0; x <= 64; x += 1) {
      const unit = { xMu: x / 64, xR: y / 32, bottomRadius, topRadius };
      const physical = transmittanceUnitToPhysical(unit);
      const recovered = transmittancePhysicalToUnit({
        radius: physical.radius,
        mu: physical.mu,
        bottomRadius,
        topRadius,
      });
      maxMuError = Math.max(maxMuError, Math.abs(recovered.xMu - unit.xMu));
      maxRadiusError = Math.max(maxRadiusError, Math.abs(recovered.xR - unit.xR));
    }
  }
  assert(maxMuError < 1e-9, `transmittance xMu round-trip ${maxMuError}`);
  assert(maxRadiusError < 1e-12, `transmittance xR round-trip ${maxRadiusError}`);
  return { maxMuError, maxRadiusError };
}

function integratePhaseOverSphere(phase, samples = 32768) {
  let integral = 0;
  const deltaMu = 2 / samples;
  for (let index = 0; index < samples; index += 1) {
    const mu = -1 + (index + 0.5) * deltaMu;
    integral += phase(mu) * 2 * Math.PI * deltaMu;
  }
  return integral;
}

function assertTransportUnitsAndPhase(atmosphereConfig) {
  assert.equal(atmosphereConfig.integrationLengthUnit, "kilometer");
  assert.equal(atmosphereConfig.coefficientUnit, "km^-1");
  const beta = 0.125;
  const distance = 8;
  assertClose(
    homogeneousTransmittance(beta, distance),
    Math.exp(-1),
    1e-15,
    "homogeneous optical-depth unit fixture",
  );
  const rayleighIntegral = integratePhaseOverSphere(rayleighPhase);
  const mieIntegral = integratePhaseOverSphere((mu) =>
    henyeyGreensteinPhase(mu, atmosphereConfig.miePhaseG),
  );
  assertClose(rayleighIntegral, 1, 1e-8, "Rayleigh phase normalization");
  assertClose(mieIntegral, 1, 2e-6, "HG phase normalization");
  assert(
    henyeyGreensteinPhase(1, atmosphereConfig.miePhaseG) >
      henyeyGreensteinPhase(-1, atmosphereConfig.miePhaseG),
    "positive g must peak toward the sun",
  );
  assert.equal(exponentialFroxelDepth(0, 160, 4), 0);
  assertClose(exponentialFroxelDepth(1, 160, 4), 160, 1e-12, "froxel far endpoint");
  const extremeHgIntegrals = {};
  for (const g of [-MAX_ABS_HG_G, 0, MAX_ABS_HG_G]) {
    const integral = integratePhaseOverSphere(
      (mu) => henyeyGreensteinPhase(mu, g),
      Math.abs(g) === MAX_ABS_HG_G ? 1048576 : 32768,
    );
    assertClose(integral, 1, 5e-5, `HG phase normalization g=${g}`);
    assert(Number.isFinite(henyeyGreensteinPhase(-1, g)), `HG g=${g} mu=-1 finite`);
    assert(Number.isFinite(henyeyGreensteinPhase(1, g)), `HG g=${g} mu=1 finite`);
    if (g > 0) {
      assert(
        henyeyGreensteinPhase(1, g) > henyeyGreensteinPhase(-1, g),
        `positive extreme g=${g} must have a forward lobe`,
      );
    } else if (g < 0) {
      assert(
        henyeyGreensteinPhase(-1, g) > henyeyGreensteinPhase(1, g),
        `negative extreme g=${g} must have a backward lobe`,
      );
    }
    extremeHgIntegrals[g] = integral;
  }
  return { rayleighIntegral, mieIntegral, extremeHgIntegrals };
}

function assertRadiometricAndCumulativeAerialContract() {
  const sliceDepthsKm = Array.from({ length: 33 }, (_, index) =>
    exponentialFroxelDepth(index / 32, 160, 4),
  );
  const extinction = [0.014, 0.021, 0.033];
  const source = [0.0042, 0.0061, 0.0094];
  const result = integrateCumulativeAerialRay({
    sliceDepthsKm,
    samplesPerInterval: 32,
    extinctionAt: () => extinction,
    sourceAt: () => source,
  });
  assert.equal(result.slices.length, sliceDepthsKm.length);
  assert.equal(
    result.evaluations,
    (sliceDepthsKm.length - 1) * 32,
    "cumulative XY-ray integration must be linear in depth, not repeated prefixes",
  );
  for (let slice = 1; slice < result.slices.length; slice += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      assert(
        result.slices[slice].opticalDepth[channel] >=
          result.slices[slice - 1].opticalDepth[channel],
        "cumulative optical depth must be non-decreasing",
      );
      assert(
        result.slices[slice].radianceResponse[channel] >=
          result.slices[slice - 1].radianceResponse[channel],
        "non-negative-source cumulative radiance must be non-decreasing",
      );
    }
  }
  const final = result.slices.at(-1);
  for (let channel = 0; channel < 3; channel += 1) {
    assertClose(
      final.opticalDepth[channel],
      extinction[channel] * 160,
      2e-12,
      `homogeneous tau channel ${channel}`,
    );
    assertClose(
      final.radianceResponse[channel],
      homogeneousRadianceResponse({
        extinctionPerKm: extinction[channel],
        sourcePerKmSr: source[channel],
        distanceKm: 160,
      }),
      4e-6,
      `homogeneous radiance response channel ${channel}`,
    );
  }
  assert.equal(
    result.units.radianceResponse,
    "relative-radiance-per-steradian-per-unit-normal-irradiance",
  );
  return {
    evaluations: result.evaluations,
    maximumDepthKm: sliceDepthsKm.at(-1),
  };
}

function assertRuntimeDependencyInvalidation(atmosphereConfig) {
  const initial = createDefaultAtmosphereRuntimeState(atmosphereConfig);
  const first = resolveAtmosphereDirtyProducts(null, initial);
  assert.deepEqual(first.dirty, [
    "transmittance",
    "multiscatter",
    "irradiance",
    "skyView",
    "aerialProducts",
  ]);

  const solarOnly = structuredClone(initial);
  solarOnly.solarNormalIrradiance = [2, 2, 2];
  assert.deepEqual(
    resolveAtmosphereDirtyProducts(initial, solarOnly).dirty,
    [],
    "factored solar magnitude must update composition uniforms without recomputing transport",
  );

  const yawOnly = structuredClone(initial);
  yawOnly.inverseViewProjectionBodyKm[0] += 0.01;
  yawOnly.inverseViewProjectionWorld[0] += 0.01;
  yawOnly.worldToView[0] += 0.01;
  assert.deepEqual(
    resolveAtmosphereDirtyProducts(initial, yawOnly).dirty,
    ["aerialProducts"],
    "camera yaw changes aerial rays but not body-frame sky-view",
  );

  const altitude = structuredClone(initial);
  altitude.cameraRadiusKm += 1;
  altitude.cameraPositionBodyKm[1] += 1;
  assert.deepEqual(
    resolveAtmosphereDirtyProducts(initial, altitude).dirty,
    ["skyView", "aerialProducts"],
    "camera altitude changes both view products",
  );

  const sunAzimuth = structuredClone(initial);
  sunAzimuth.sunDirectionBody = [0.6, initial.localSunMu, 0.35];
  const magnitude = Math.hypot(...sunAzimuth.sunDirectionBody);
  sunAzimuth.sunDirectionBody = sunAzimuth.sunDirectionBody.map((value) => value / magnitude);
  sunAzimuth.localSunMu = sunAzimuth.sunDirectionBody[1];
  // Preserve zenith exactly so only the per-ray aerial sun frame changes.
  sunAzimuth.localSunMu = initial.localSunMu;
  const radial = Math.sqrt(1 - initial.localSunMu ** 2);
  sunAzimuth.sunDirectionBody = [radial, initial.localSunMu, 0];
  assert.deepEqual(
    resolveAtmosphereDirtyProducts(initial, sunAzimuth).dirty,
    ["aerialProducts"],
    "sun azimuth at fixed zenith must not rebuild the axisymmetric sky-view LUT",
  );

  const sunZenith = structuredClone(initial);
  sunZenith.localSunMu = 0.2;
  sunZenith.sunDirectionBody = [Math.sqrt(0.96), 0.2, 0];
  assert.deepEqual(
    resolveAtmosphereDirtyProducts(initial, sunZenith).dirty,
    ["skyView", "aerialProducts"],
    "sun zenith changes both live view products",
  );

  const resize = structuredClone(initial);
  resize.viewport = [641, 359];
  assert.deepEqual(
    resolveAtmosphereDirtyProducts(initial, resize).dirty,
    ["aerialProducts"],
    "viewport/aspect changes the aerial ray grid only",
  );
  const floatingOriginOnly = structuredClone(initial);
  floatingOriginOnly.cameraPositionWorld[0] += 100000;
  floatingOriginOnly.inverseViewProjectionWorld[12] += 100000;
  floatingOriginOnly.worldToBody[12] -= 100000;
  assert.deepEqual(
    resolveAtmosphereDirtyProducts(initial, floatingOriginOnly).dirty,
    [],
    "pure floating-origin translation preserving body-relative rays must not rebuild LUTs",
  );
  return { first: first.dirty, solarOnly: [], yawOnly: ["aerialProducts"] };
}

function assertHostCameraBodyDerivation(atmosphereConfig) {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 30000);
  camera.position.set(0, 6362, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(900, 6335, 0);
  const sun = new Vector3(0.4, 0.72, 0.56).normalize();
  const body = new Matrix4().makeTranslation(11, -7, 3);
  const state = deriveAtmosphereRuntimeState({
    camera,
    bodyWorldMatrix: body,
    sunDirectionWorld: sun,
    config: atmosphereConfig,
    viewport: [1200, 800],
  });
  assert.equal(state.inverseViewProjectionWorld.length, 16);
  assert.equal(state.inverseViewProjectionBodyKm.length, 16);
  assert.equal(state.worldToBody.length, 16);
  assert.equal(state.worldToView.length, 16);
  assert(Math.abs(Math.hypot(...state.sunDirectionBody) - 1) < 1e-12);
  assert(state.cameraRadiusKm > 0);
  assert(state.aerialFarKm >= 160);
  assert.notDeepEqual(state.cameraPositionWorld, state.cameraPositionBodyKm);
  return {
    cameraRadiusKm: state.cameraRadiusKm,
    localSunMu: state.localSunMu,
    aerialFarKm: state.aerialFarKm,
  };
}

function assertCanonicalRuntimeSourceStructure() {
  const browserSource = readFileSync(resolve(here, "browser-app.js"), "utf8");
  const computeSource = readFileSync(
    resolve(here, "webgpu-lut-atmosphere.js"),
    "utf8",
  );
  assert.match(browserSource, /scenePass\.getTextureNode\("depth"\)/);
  assert.match(browserSource, /createAtmosphereCompositeNode\(\{/);
  assert.match(browserSource, /planet\.matrixWorld/);
  assert.match(browserSource, /deriveAtmosphereRuntimeState\(\{/);
  assert.match(browserSource, /addEventListener\("(?:change|input)"/);
  assert.doesNotMatch(
    browserSource,
    /final:\s*twoD\("sky-view"\)/,
    "final output must compose the live scene/depth path, not alias the sky-view texture",
  );
  assert.doesNotMatch(
    browserSource,
    /vec4\(screenUV\.y,\s*screenUV\.y,\s*screenUV\.y/,
    "depth diagnostics must not be a UV ramp",
  );
  assert.doesNotMatch(
    browserSource,
    /vec4\(screenUV\.x,\s*screenUV\.y,\s*0\.5/,
    "ECEF diagnostics must not be a UV ramp",
  );
  assert.match(computeSource, /one invocation owns one XY ray/i);
  assert.match(computeSource, /for \(let slice = 0; slice < dimensions\.depth; slice \+= 1\)/);
  assert.match(computeSource, /atmosphere:aerial-cumulative-xy-rays/);
  assert.doesNotMatch(computeSource, /AERIAL_FROXEL_TAN_HALF_FOV/);
  assert.doesNotMatch(computeSource, /ATMOSPHERE_SUN_DIRECTION/);

  const induced = process.env.ATMOSPHERE_VALIDATION_INDUCE;
  if (induced === "fixed-final") assert.fail("mutation: fixed sky-view final");
  if (induced === "uv-ramp-diagnostics") assert.fail("mutation: UV-ramp depth/ECEF diagnostics");
  if (induced === "independent-aerial-prefixes") {
    assert.fail("mutation: independent per-voxel aerial prefix integration");
  }
  if (induced === "unbound-live-controls") {
    assert.fail("mutation: controls change labels without runtime invalidation");
  }
  return {
    liveDepth: true,
    bodyTransform: true,
    cumulativeAerial: true,
    controlsBound: true,
  };
}

function assertEllipsoidAndEcefContract() {
  const wgs84 = { semiMajorMeters: 6378137, semiMinorMeters: 6356752.314245 };
  const fixtures = [
    { latitudeRadians: 0, longitudeRadians: 0, heightMeters: 0 },
    { latitudeRadians: 0.7, longitudeRadians: -1.2, heightMeters: 1234.5 },
    { latitudeRadians: -1.1, longitudeRadians: 2.4, heightMeters: 400000 },
    { latitudeRadians: Math.PI / 2, longitudeRadians: 0, heightMeters: 50 },
  ];
  let maximumHeightErrorMeters = 0;
  let maximumLatitudeErrorRadians = 0;
  for (const fixture of fixtures) {
    const position = geodeticToEcef({ ...fixture, ...wgs84 });
    const recovered = ecefToGeodetic({ position, ...wgs84 });
    maximumHeightErrorMeters = Math.max(
      maximumHeightErrorMeters,
      Math.abs(recovered.heightMeters - fixture.heightMeters),
    );
    maximumLatitudeErrorRadians = Math.max(
      maximumLatitudeErrorRadians,
      Math.abs(recovered.latitudeRadians - fixture.latitudeRadians),
    );
  }
  assert(maximumHeightErrorMeters < 1e-5, `ECEF height error ${maximumHeightErrorMeters}`);
  assert(maximumLatitudeErrorRadians < 1e-12, `ECEF latitude error ${maximumLatitudeErrorRadians}`);

  const interval = rayEllipsoidInterval({
    origin: [7000000, 0, 0],
    direction: [-1, 0, 0],
    axes: [wgs84.semiMajorMeters, wgs84.semiMajorMeters, wgs84.semiMinorMeters],
  });
  assert.equal(interval.hit, true);
  assertClose(interval.near, 7000000 - wgs84.semiMajorMeters, 1e-9, "ellipsoid near root");
  assertClose(interval.far, 7000000 + wgs84.semiMajorMeters, 1e-6, "ellipsoid far root");
  const miss = rayEllipsoidInterval({
    origin: [7000000, 0, 0],
    direction: [0, 1, 0],
    axes: [wgs84.semiMajorMeters, wgs84.semiMajorMeters, wgs84.semiMinorMeters],
  });
  assert.equal(miss.hit, false);
  return { maximumHeightErrorMeters, maximumLatitudeErrorRadians };
}

function assertDepthReconstruction() {
  const near = 0.1;
  const far = 1000;
  const fixtures = [
    {
      mode: "standardPerspective",
      encode: (viewZ) => perspectiveViewZToDepth(viewZ, near, far),
      decode: (depth) => perspectiveDepthToViewZ(depth, near, far),
      orthographicReversed: false,
    },
    {
      mode: "reversedPerspective",
      encode: (viewZ) => reversedPerspectiveViewZToDepth(viewZ, near, far),
      decode: (depth) => reversedPerspectiveDepthToViewZ(depth, near, far),
      orthographicReversed: false,
    },
    {
      mode: "logarithmicPerspective",
      encode: (viewZ) => logarithmicViewZToDepth(viewZ, near, far),
      decode: (depth) => logarithmicDepthToViewZ(depth, near, far),
      orthographicReversed: false,
    },
    {
      mode: "orthographic",
      encode: (viewZ) => orthographicViewZToDepth(viewZ, near, far, false),
      decode: (depth) => orthographicDepthToViewZ(depth, near, far, false),
      orthographicReversed: false,
    },
    {
      mode: "orthographic",
      label: "reversedOrthographic",
      encode: (viewZ) => orthographicViewZToDepth(viewZ, near, far, true),
      decode: (depth) => orthographicDepthToViewZ(depth, near, far, true),
      orthographicReversed: true,
    },
  ];
  let maxViewZError = 0;
  for (const fixture of fixtures) {
    const label = fixture.label ?? fixture.mode;
    for (const viewZ of [-near, -1, -10, -123.5, -far]) {
      const reconstructed = fixture.decode(fixture.encode(viewZ));
      maxViewZError = Math.max(maxViewZError, Math.abs(reconstructed - viewZ));
      assertClose(reconstructed, viewZ, 2e-9, `${label} depth round-trip ${viewZ}`);
    }

    const nearestViewZ = -10;
    const fartherViewZ = -50;
    const nearestDepth = fixture.encode(nearestViewZ);
    const fartherDepth = fixture.encode(fartherViewZ);
    const resolved = resolveNearestSurfaceDepth({
      depthSamples: [fartherDepth, 0.25, nearestDepth, 0.75],
      coverageSamples: [true, false, true, false],
      resolvedDepthMode: fixture.mode,
      orthographicReversed: fixture.orthographicReversed,
    });
    assert.equal(resolved.covered, true, `${label} resolved coverage`);
    const classified = classifyDepthSample({
      depth: resolved.depth,
      mode: "msaaResolved",
      resolvedDepthMode: fixture.mode,
      orthographicReversed: fixture.orthographicReversed,
      msaaResolvePolicy: "nearest-surface",
      near,
      far,
    });
    assertClose(classified.viewZ, nearestViewZ, 2e-9, `${label} resolved view Z`);
  }

  const uncovered = resolveNearestSurfaceDepth({
    depthSamples: [0.2, 0.8],
    coverageSamples: [false, false],
    resolvedDepthMode: "standardPerspective",
  });
  assert.equal(uncovered.covered, false, "uncovered MSAA pixel must remain sky");
  return { maxViewZError, testedConversions: fixtures.length };
}

function assertComputeNode(node, name) {
  assert.equal(typeof node, "object", `${name} must be an object`);
  assert.notEqual(typeof node, "string", `${name} must not be a descriptor string`);
  assert.equal(node.isComputeNode, true, `${name} must be a ComputeNode`);
  assert.equal(typeof node.computeNode, "object", `${name} graph must exist`);
  assert(Number.isFinite(node.count), `${name} count must be finite`);
  assert(Array.isArray(node.workgroupSize), `${name} workgroup must be an array`);
}

assertManifestAssets();

const buffers = Object.fromEntries(
  Object.entries(manifest.textures).map(([name, texture]) => [
    name,
    bufferFor(texture),
  ]),
);
const lutValidation = validateAtmosphereLuts(manifest, buffers);
assert.equal(lutValidation.ok, true, lutValidation.errors.join("\n"));
assert.equal(manifest.integrationLengthUnit, "kilometer");
assert.equal(manifest.coefficientUnit, "km^-1");
assert.equal(
  manifest.evidenceStatus.includes("does not validate the live Phase 1"),
  true,
);

const textures = createAtmosphereLutTextures(buffers, manifest);
assert.equal(textures.transmittance.image.width, 256);
assert.equal(textures.scattering.image.depth, 32);
assert.equal(textures.irradiance.image.height, 16);
assertTextureUploadPolicy(textures);

const config = createAtmosphereConfig({ tier: "budgeted" });
const configValidation = validateAtmosphereConfig(config);
assert.equal(configValidation.ok, true, configValidation.errors.join("\n"));
const manifestCompatibility = validateAtmosphereManifestCompatibility(manifest, config);
assert.equal(
  manifestCompatibility.ok,
  true,
  manifestCompatibility.errors.join("\n"),
);
assert.equal(
  validateAtmosphereLuts(manifest, buffers, config).ok,
  true,
  "manifest-backed LUTs must match the live physical model before use",
);
assert(configValidation.memoryBytes > 0);
assert.equal(configValidation.memoryEvidenceStatus.includes("not peak live memory"), true);
assert(config.products.some((product) => product.id === "aerial-inscattering"));
assert(config.products.some((product) => product.id === "aerial-optical-depth"));
assertTransmittanceMirrorInvariants(config);
const lutMapEvidence = assertLutParameterizationRoundTrip(config);
const phaseEvidence = assertTransportUnitsAndPhase(config);
const radiometricEvidence = assertRadiometricAndCumulativeAerialContract();
const invalidationEvidence = assertRuntimeDependencyInvalidation(config);
const hostCameraEvidence = assertHostCameraBodyDerivation(
  createAtmosphereConfig({ tier: "high", renderUnitsPerMeter: 0.001 }),
);
const runtimeSourceEvidence = assertCanonicalRuntimeSourceStructure();
const ellipsoidEvidence = assertEllipsoidAndEcefContract();
for (const tier of ["ultra", "high", "mobile"]) {
  assert(QUALITY_TIERS[tier], `canonical atmosphere tier ${tier} must exist`);
  const products = createProductSchedule(tier);
  assert.equal(products.length, 6);
  assert(products.every((product) => product.implementationStatus.startsWith("kernel-implemented")));
}
const reusableStage = createAtmosphereStage({ config });
assert.equal(reusableStage.system.pipeline, undefined, "integration stage must not own a RenderPipeline");
assert.equal(typeof reusableStage.createResources, "function");
const depthReconstructionEvidence = assertDepthReconstruction();

for (const product of config.products) {
  const expectedInvocations = product.kernelId === "aerial-products"
    ? product.dimensions.width * product.dimensions.height
    : product.dimensions.width * product.dimensions.height * (product.dimensions.depth ?? 1);
  const expectedWorkgroupInvocations = product.workgroup.reduce(
    (total, extent) => total * extent,
    1,
  );
  const expectedGroups = Math.ceil(
    expectedInvocations / expectedWorkgroupInvocations,
  );
  assert.equal(product.invocationCount, expectedInvocations, `${product.id} invocation count`);
  assert.equal(
    product.workgroupInvocations,
    expectedWorkgroupInvocations,
    `${product.id} workgroup invocation count`,
  );
  assert.equal(
    product.flattenedWorkgroupCount,
    expectedGroups,
    `${product.id} flattened groups`,
  );
  assert.deepEqual(product.dispatch, [expectedGroups, 1, 1], `${product.id} r185 dispatch`);
  if (product.kernelId === "aerial-products") {
    assert.equal(
      product.invocationTopology,
      "one invocation per XY ray; cumulative Z loop inside the kernel",
    );
    assert.equal(
      product.outputTexelCount,
      product.dimensions.width * product.dimensions.height * product.dimensions.depth,
    );
  }
}

const invalidRadii = createAtmosphereConfig();
invalidRadii.radiiMeters.top = invalidRadii.radiiMeters.bottom;
expectInvalidConfig(invalidRadii, "top radius");

const invalidMie = createAtmosphereConfig();
invalidMie.mieExtinctionPerKm = [0.003, 0.003, 0.003];
expectInvalidConfig(invalidMie, "mieExtinctionPerKm");

const invalidPhase = createAtmosphereConfig();
invalidPhase.miePhaseG = MAX_ABS_HG_G + 1e-6;
expectInvalidConfig(invalidPhase, `abs(g) <= ${MAX_ABS_HG_G}`);

const incompatibleManifest = structuredClone(manifest);
incompatibleManifest.atmosphere.miePhaseG = 0.7;
assert.equal(
  validateAtmosphereManifestCompatibility(incompatibleManifest, config).ok,
  false,
  "manifest/live phase mismatch must fail",
);

for (const fixture of UNIT_CONVERSION_FIXTURES) {
  const unitConfig = createAtmosphereConfig({
    renderUnitsPerMeter: fixture.renderUnitsPerMeter,
  });
  assert.equal(
    renderUnitsToAtmosphereMeters(fixture.worldDistance, unitConfig),
    fixture.atmosphereMeters,
    fixture.name,
  );
}

const topRadius = manifest.atmosphere.topRadiusMeters / 1000;
const crossingCamera = [7000, 0, 0];
const crossingPoint = [-7000, 0, 0];
assert.equal(
  segmentOutsideAtmosphereOldExpression(crossingCamera, crossingPoint, topRadius),
  true,
  "old closest-point expression rejects a crossing segment",
);
assert.equal(
  segmentOutsideAtmosphere(crossingCamera, crossingPoint, topRadius),
  false,
  "fixed closest-point expression accepts a crossing segment",
);

const tangentCamera = [-1000, topRadius, 0];
const tangentPoint = [1000, topRadius, 0];
assert.equal(
  segmentOutsideAtmosphereOldExpression(tangentCamera, tangentPoint, topRadius),
  true,
  "old closest-point expression rejects a tangent segment",
);
assert.equal(
  segmentOutsideAtmosphere(tangentCamera, tangentPoint, topRadius),
  false,
  "fixed closest-point expression accepts a tangent segment",
);

const missCamera = [-1000, topRadius + 10, 0];
const missPoint = [1000, topRadius + 10, 0];
assert.equal(segmentOutsideAtmosphere(missCamera, missPoint, topRadius), true);

const missRay = normalize([0.96, -0.28, 0]);
const outsideCamera = [0, 7000, 0];
const oldMiss = topAtmosphereIntersectionOldSafeSqrt(
  outsideCamera,
  missRay,
  topRadius,
);
assert.equal(oldMiss.hit, true, "old safeSqrt path invents a shell entry");
const guardedMiss = topAtmosphereIntersection(outsideCamera, missRay, topRadius);
assert.equal(guardedMiss.hit, false, "top atmosphere miss must not enter shell");
assert.equal(guardedMiss.topAtmosphereMiss, true);
assert.deepEqual(guardedMiss.transmittance, [1, 1, 1]);
assert.deepEqual(guardedMiss.radiance, [0, 0, 0]);

assert(Number.isFinite(perspectiveDepthToViewZ(0.5, 0.1, 1000)));
assert(Number.isFinite(reversedPerspectiveDepthToViewZ(0.5, 0.1, 1000)));
assert(Number.isFinite(orthographicDepthToViewZ(0.5, 0.1, 1000)));
assertClose(perspectiveDepthToViewZ(0, 0.1, 1000), -0.1, 1e-15, "standard near");
assertClose(perspectiveDepthToViewZ(1, 0.1, 1000), -1000, 1e-9, "standard far");
assertClose(reversedPerspectiveDepthToViewZ(1, 0.1, 1000), -0.1, 1e-15, "reversed near");
assertClose(reversedPerspectiveDepthToViewZ(0, 0.1, 1000), -1000, 1e-9, "reversed far");
assertClose(logarithmicDepthToViewZ(0, 0.1, 1000), -0.1, 1e-15, "log near");
assertClose(logarithmicDepthToViewZ(1, 0.1, 1000), -1000, 1e-9, "log far");
assertClose(
  perspectiveViewZToMetricRayDistance(-10, -0.5),
  20,
  1e-15,
  "off-axis metric ray distance",
);
assert.equal(classifyDepthSample({ depth: 1 }).kind, "surface pixel");
assert.equal(classifyDepthSample({ depth: 1, noSurface: true }).kind, "sky pixel");
assert.equal(
  classifyDepthSample({
    depth: 0,
    mode: "reversedPerspective",
    clearDepthIsNoSurface: true,
  }).kind,
  "sky pixel",
);
assert.throws(
  () => classifyDepthSample({ depth: 0.5, mode: "msaaResolved" }),
  /nearest-surface/,
);
assert.equal(
  classifyDepthSample({
    depth: 0.5,
    mode: "msaaResolved",
    msaaResolvePolicy: "nearest-surface",
    resolvedDepthMode: "standardPerspective",
  }).kind,
  "surface pixel",
);

const atmosphere = new WebGPULutAtmosphere({ config, lutTextures: textures });
const resourcePlan = atmosphere.createResourcePlan();
assert.equal(resourcePlan.renderer.renderer, "WebGPURenderer");
assert(resourcePlan.products.some((product) => product.id === "sky-view"));
assert.equal(resourcePlan.evidenceStatus.includes("not peak live memory"), true);
assert.equal(
  resourcePlan.phase1KernelResourcePayloadBytes,
  resourcePlan.authoredSchedulePayloadBytes,
  "every scheduled atmosphere product must have a constructed compute graph/resource",
);
const uniqueImplementedKernels = Array.from(
  new Map(
    config.products
      .filter((product) => product.implementationStatus.startsWith("kernel-implemented"))
      .map((product) => [product.kernelId, product]),
  ).values(),
);
assert.equal(
  resourcePlan.phase1FlattenedDispatchGroups,
  uniqueImplementedKernels.reduce(
    (total, product) => total + product.flattenedWorkgroupCount,
    0,
  ),
  "Phase 1 dispatch accounting must count the shared aerial kernel once",
);
assert(
  atmosphere
    .createComputeDispatchDescriptors()
    .some((descriptor) => descriptor.api === "Fn().compute(count)"),
);
assert.equal(
  atmosphere.createPassGraph().implementationStatus.startsWith("implemented-native"),
  true,
);
assert.equal(typeof TSL_COMPUTE_SCAFFOLD, "object");
assert.equal(PIPELINE_SCAFFOLD.status, "implemented-runtime-structure-unaccepted");
const inducedOutputTransform =
  process.env.ATMOSPHERE_VALIDATION_INDUCE === "output-transform";
assert.equal(
  inducedOutputTransform ? true : atmosphere.createPassGraph().outputColorTransform,
  false,
  "renderOutput-owned pipeline must keep outputColorTransform false",
);
atmosphere.createStorageResources();
for (const [id, resource] of atmosphere.resources) {
  assert.equal(resource.generateMipmaps, false, `${id} base-level-only mip policy`);
  if ("mipmapsAutoUpdate" in resource) {
    assert.equal(resource.mipmapsAutoUpdate, false, `${id} automatic mip policy`);
  }
  assert.equal(resource.minFilter, LinearFilter, `${id} live minFilter`);
  assert.equal(resource.magFilter, LinearFilter, `${id} live magFilter`);
  assert.equal(
    resource.wrapS,
    id === "sky-view" ? RepeatWrapping : ClampToEdgeWrapping,
    `${id} live azimuth/wrap policy`,
  );
}
const kernels = atmosphere.createComputeKernels();
assertComputeNode(kernels.transmittance, "transmittance kernel");
assertComputeNode(kernels.multiscatter, "multiscatter kernel");
assertComputeNode(kernels.irradiance, "irradiance kernel");
assertComputeNode(kernels.skyView, "sky-view kernel");
assertComputeNode(kernels.aerialProducts, "aerial products kernel");
assert.equal(
  kernels.transmittance.count,
  config.products.find((product) => product.id === "transmittance").invocationCount,
  "transmittance compute count",
);
assert.equal(
  kernels.aerialProducts.count,
  config.products.find((product) => product.id === "aerial-inscattering").invocationCount,
  "shared aerial compute count",
);
assert.deepEqual(kernels.executionOrder, [
  "transmittance",
  "multiscatter",
  "irradiance",
  "skyView",
  "aerialProducts",
]);
assert(kernels.limitations.some((item) => item.includes("reference-radiance")));
const descriptors = atmosphere.createComputeDispatchDescriptors();
for (const product of [
  "transmittance",
  "multiscatter",
  "irradiance",
  "sky-view",
  "aerial-inscattering",
  "aerial-optical-depth",
]) {
  assert(
    descriptors
      .find((item) => item.product === product)
      .implementationStatus.startsWith("kernel-implemented"),
    `${product} must preserve the validator submission boundary`,
  );
}
const resizeEvidence = atmosphere.resize(1920, 1080);
assert.equal(resizeEvidence.resourceResize, "not-applicable");
assert.deepEqual(resizeEvidence.viewport, {
  width: 1920,
  height: 1080,
});
assert.deepEqual(resizeEvidence.dirtyProducts, ["aerialProducts"]);
atmosphere.dispose();
assert(atmosphere.disposeCounters.storageTextures >= 1);

const nonWebGpuAtmosphere = new WebGPULutAtmosphere({ config, lutTextures: textures });
await assert.rejects(
  () =>
    nonWebGpuAtmosphere.initialize({
      init: async () => {},
      backend: { isWebGPUBackend: false },
    }),
  /native WebGPU backend/,
);

// Source checks are narrow structural guards. They are not substitutes for the
// executed CPU fixtures or for future GPU/browser evidence.
const runtimeSource = readFileSync(resolve(here, "webgpu-lut-atmosphere.js"), "utf8");
const depthSource = readFileSync(resolve(here, "depth-contract.js"), "utf8");
assert(runtimeSource.includes('from "three/webgpu"'));
assert(runtimeSource.includes('from "three/tsl"'));
assert(runtimeSource.includes("texture(transmittanceTex, transmittanceUv)"));
assert(depthSource.includes("logarithmicDepthToViewZ"));
assert(depthSource.includes("orthographicDepthToViewZ"));
assert(!depthSource.includes("logDepthBufFC"));
assert(!depthSource.includes("perspectiveDepthToViewZ(1.0 - depth)"));
assert(!runtimeSource.includes("await renderer.computeAsync"));
assert(runtimeSource.includes("renderer.compute(kernels[product])"));
assert(
  !/outputColorTransform\s*=\s*true/u.test(runtimeSource),
  "renderOutput-owned atmosphere source must not set outputColorTransform true",
);

console.log(
  "webgpu-lut-atmosphere structural/equation validation passed",
  JSON.stringify({
    scope: VALIDATION_SCOPE,
    lutMapEvidence,
    phaseEvidence,
    radiometricEvidence,
    invalidationEvidence,
    hostCameraEvidence,
    runtimeSourceEvidence,
    ellipsoidEvidence,
    depthReconstructionEvidence,
    manifestCompatibility: manifestCompatibility.evidenceStatus,
    authoredSchedulePayloadBytes: resourcePlan.authoredSchedulePayloadBytes,
    phase1KernelResourcePayloadBytes: resourcePlan.phase1KernelResourcePayloadBytes,
    phase1FlattenedDispatchGroups: resourcePlan.phase1FlattenedDispatchGroups,
  }),
);
