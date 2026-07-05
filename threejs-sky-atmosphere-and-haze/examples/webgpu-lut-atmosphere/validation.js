import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
} from "three/webgpu";

import {
  UNIT_CONVERSION_FIXTURES,
  createAtmosphereConfig,
  renderUnitsToAtmosphereMeters,
  validateAtmosphereConfig,
} from "./atmosphere-config.js";
import {
  classifyDepthSample,
  orthographicDepthToViewZ,
  perspectiveDepthToViewZ,
  reversedPerspectiveDepthToViewZ,
} from "./depth-contract.js";
import {
  createAtmosphereLutTextures,
  validateAtmosphereLuts,
} from "./load-atmosphere-luts.js";
import {
  normalize,
  segmentOutsideAtmosphere,
  segmentOutsideAtmosphereOldExpression,
  topAtmosphereIntersection,
  topAtmosphereIntersectionOldSafeSqrt,
} from "./atmosphere-math.js";
import {
  PIPELINE_SCAFFOLD,
  TSL_COMPUTE_SCAFFOLD,
  WebGPULutAtmosphere,
} from "./webgpu-lut-atmosphere.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const assetDir = resolve(root, "assets/lut-aerial-perspective");
const manifestPath = resolve(assetDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

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

const textures = createAtmosphereLutTextures(buffers, manifest);
assert.equal(textures.transmittance.image.width, 256);
assert.equal(textures.scattering.image.depth, 32);
assert.equal(textures.irradiance.image.height, 16);
assertTextureUploadPolicy(textures);

const config = createAtmosphereConfig({ tier: "high" });
const configValidation = validateAtmosphereConfig(config);
assert.equal(configValidation.ok, true, configValidation.errors.join("\n"));
assert(configValidation.memoryBytes > 0);
assert(config.products.some((product) => product.label === "aerial froxel"));
assertTransmittanceMirrorInvariants(config);

const invalidRadii = createAtmosphereConfig();
invalidRadii.radiiMeters.top = invalidRadii.radiiMeters.bottom;
expectInvalidConfig(invalidRadii, "top radius");

const invalidMie = createAtmosphereConfig();
invalidMie.mieExtinctionPerKm = [0.003996, 0.003996, 0.003996];
expectInvalidConfig(invalidMie, "mieExtinctionPerKm");

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
assert.equal(classifyDepthSample({ depth: 1 }).kind, "sky pixel");
assert.equal(
  classifyDepthSample({
    depth: 0,
    mode: "reversedPerspective",
  }).kind,
  "sky pixel",
);
assert.equal(classifyDepthSample({ depth: 0.5, mode: "msaaResolved" }).kind, "surface pixel");

const atmosphere = new WebGPULutAtmosphere({ config, lutTextures: textures });
const resourcePlan = atmosphere.createResourcePlan();
assert.equal(resourcePlan.renderer.renderer, "WebGPURenderer");
assert(resourcePlan.products.some((product) => product.id === "sky-view"));
assert(
  atmosphere
    .createComputeDispatchDescriptors()
    .some((descriptor) => descriptor.api === "Fn().compute(count)"),
);
assert.equal(
  atmosphere.createPassGraph().output,
  "renderOutput owns final presentation; RenderPipeline.outputColorTransform is false",
);
assert.equal(typeof TSL_COMPUTE_SCAFFOLD, "object");
assert(PIPELINE_SCAFFOLD.includes("renderPipeline.outputColorTransform = false"));
const inducedOutputTransform =
  process.env.ATMOSPHERE_VALIDATION_INDUCE === "output-transform";
assert.equal(
  inducedOutputTransform ? true : atmosphere.createPassGraph().outputColorTransform,
  false,
  "renderOutput-owned pipeline must keep outputColorTransform false",
);
atmosphere.createStorageResources();
const kernels = atmosphere.createComputeKernels();
assertComputeNode(kernels.transmittance, "transmittance kernel");
assertComputeNode(kernels.aerialFroxel, "aerial froxel kernel");
assert(
  kernels.omissions.some((item) => item.includes("single-scattering")),
  "single-scattering omission must be explicit",
);
atmosphere.resize(1920, 1080);
atmosphere.dispose();
assert(atmosphere.disposeCounters.storageTextures >= 1);

const nonWebGpuAtmosphere = new WebGPULutAtmosphere({ config, lutTextures: textures });
await assert.rejects(
  () =>
    nonWebGpuAtmosphere.initialize({
      init: async () => {},
      backend: { isWebGPUBackend: false },
    }),
  /threejs-compatibility-fallbacks/,
);

const source = [
  "README.md",
  "atmosphere-config.js",
  "depth-contract.js",
  "load-atmosphere-luts.js",
  "webgpu-lut-atmosphere.js",
]
  .map((file) => readFileSync(resolve(here, file), "utf8"))
  .join("\n");

for (const required of [
  "three/webgpu",
  "three/tsl",
  "StorageTexture",
  "Storage3DTexture",
  "RenderPipeline",
  "WebGPURenderer",
  "Fn().compute",
  "textureStore",
  "NoColorSpace",
  "HalfFloatType",
  "RenderPipeline.outputColorTransform",
  "PassNode.getLinearDepthNode",
  "PassNode.getViewZNode",
  "reversedDepthBuffer",
  "logarithmicDepthToViewZ",
  "orthographicDepthToViewZ",
  "sky pixel",
  "MSAA",
  "resize(",
  "dispose(",
  "lut-coordinates",
  "optical-depth",
  "sun-visibility",
  "shell-post",
  "froxel-depth",
  "altitude",
  "threejs-compatibility-fallbacks",
  "single-scattering",
]) {
  assert(source.includes(required), `missing ${required}`);
}

for (const forbidden of ["agxApprox", "uExposure", "toneMap("]) {
  assert(!source.includes(forbidden), `canonical source contains ${forbidden}`);
}

assert(
  !/outputColorTransform\s*=\s*true/.test(source),
  "renderOutput-owned atmosphere source must not set outputColorTransform true",
);

console.log("webgpu-lut-atmosphere validation passed");
