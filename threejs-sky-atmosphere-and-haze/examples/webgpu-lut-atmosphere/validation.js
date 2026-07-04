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
import { WebGPULutAtmosphere } from "./webgpu-lut-atmosphere.js";

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
  "scene-linear HDR radiance into one RenderPipeline.outputColorTransform owner",
);
atmosphere.createStorageResources();
atmosphere.resize(1920, 1080);
atmosphere.dispose();
assert(atmosphere.disposeCounters.storageTextures >= 1);

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
]) {
  assert(source.includes(required), `missing ${required}`);
}

for (const forbidden of ["agxApprox", "uExposure", "toneMap("]) {
  assert(!source.includes(forbidden), `canonical source contains ${forbidden}`);
}

console.log("webgpu-lut-atmosphere validation passed");
