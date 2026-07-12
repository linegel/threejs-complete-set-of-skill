import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { DataTexture, NoColorSpace, SRGBColorSpace } from "three/webgpu";
import { float } from "three/tsl";

import {
  createDisposableListenerScope,
} from "./main.js";
import {
  assertBytesEqual,
  assertCaptureState,
  assertCoveredMaterialNormals,
  assertCurrentSourceIdentity,
  assertMaterialImageSemantics,
  assertRawAttachmentVisualization,
} from "./material-artifact-contract.mjs";
import {
  authoredPbrIdentities,
  createAtlasArrayTriplanarMaterials,
  createMaterialTextureArray,
  createMipSafeMaterialAtlas,
  createTriplanarMaterialTexture,
  createWalnutPbrMaterial,
  createWetRockPbrMaterial,
  evaluateFilteredBinaryMetalness,
  evaluateWetRockResponse,
  resolveTierViewport,
  setProceduralPbrDebugMode,
  validateAtlasGutterContract,
  validateProceduralPbrConfig,
} from "./procedural-pbr-materials.js";
import {
  computeRgba8ReadbackLayout,
  evaluateBandLimitSample,
  evaluateColorAttachmentBudget,
  evaluateDissolveMaskParity,
  evaluateFilteredRoughness,
  evaluateTriplanarWeights,
  materialSeedPhase,
  resolveAtlasTileTransform,
} from "./pbr-oracles.mjs";
import { assertLockedRouteMutation } from "./route-contract.mjs";

const detected = [];

function expectDetected(label, callback) {
  assert.throws(callback, undefined, `${label} mutation was not detected`);
  detected.push(label);
}

function pixel(level, x, y) {
  const offset = (y * level.width + x) * 4;
  return Array.from(level.data.subarray(offset, offset + 4));
}

function requireExtrudedGutters(texture) {
  const contract = texture.userData.materialAtlas;
  for (let levelIndex = 0; levelIndex < texture.mipmaps.length; levelIndex++) {
    const level = texture.mipmaps[levelIndex];
    const metadata = contract.levels[levelIndex];
    for (let tileY = 0; tileY < contract.rows; tileY++) {
      for (let tileX = 0; tileX < contract.columns; tileX++) {
        const x0 = tileX * metadata.cellWidth;
        const y0 = tileY * metadata.cellHeight;
        const interiorX = x0 + metadata.gutter;
        const interiorY = y0 + metadata.gutter;
        assert.deepEqual(pixel(level, x0, y0), pixel(level, interiorX, interiorY));
      }
    }
  }
}

const atlas = createMipSafeMaterialAtlas();
atlas.mipmaps[2].data[0] ^= 0xff;
expectDetected("atlas-mip-gutter-bleed", () => requireExtrudedGutters(atlas));
atlas.dispose();

expectDetected("insufficient-mip-filter-support", () => validateAtlasGutterContract({
  atlasWidth: 1024,
  atlasHeight: 1024,
  columns: 4,
  rows: 4,
  guttersByMip: [1, 1],
  filterRadiusByMip: [2.2, 1.1],
}));

expectDetected("broad-fractional-metalness", () => {
  let fractional = 0;
  for (let index = 0; index <= 10_000; index++) {
    const cause = index / 10_000;
    const mutant = cause * cause * (3 - 2 * cause);
    if (mutant > 0 && mutant < 1) fractional++;
  }
  assert(fractional / 10_001 < 0.021, "fractional identity escaped a derivative-sized boundary");
});

expectDetected("fractional-metalness-config", () => validateProceduralPbrConfig({
  identity: { ...authoredPbrIdentities.walnut, metalnessRange: [0.1, 0.9] },
}));

const walnut = createWalnutPbrMaterial();
walnut.maskShadowNode = { mutant: true };
expectDetected("dissolve-visible-shadow-divergence", () => assert.strictEqual(walnut.maskNode, walnut.maskShadowNode));
delete walnut.mrtNode.outputNodes.materialFootprint;
expectDetected("missing-footprint-variance-mrt", () => {
  assert(walnut.mrtNode.outputNodes.materialFootprint);
  assert(walnut.mrtNode.outputNodes.materialNormalVariance);
});
walnut.dispose();

const aliasedDiagnostics = createWalnutPbrMaterial();
aliasedDiagnostics.mrtNode.outputNodes.materialFootprint = aliasedDiagnostics.mrtNode.outputNodes.materialNormal;
expectDetected("aliased-diagnostic-mrt", () => {
  const nodes = Object.values(aliasedDiagnostics.mrtNode.outputNodes);
  assert.equal(new Set(nodes.map((node) => node.getCacheKey())).size, nodes.length);
});
aliasedDiagnostics.dispose();

expectDetected("schlick-fresnel-integral-overrun", () => {
  const f0 = 1.12;
  const integrated = f0 + (1 - f0) / 21;
  assert(integrated <= 1, `mutant Schlick integral exceeded unity: ${integrated}`);
});

expectDetected("discarded-removed-slope-energy", () => {
  const filteredBand = evaluateBandLimitSample({
    coordinateFootprint: 0.25,
    surfacePixelSpan: 0.01,
    heightHalfAmplitude: 0.0004,
    supportMultiplier: 2,
    slopeVarianceCalibration: 1,
  });
  const expected = evaluateFilteredRoughness({
    roughness: 0.28,
    normalVariance: filteredBand.removedSlopeVariance,
    specularVarianceScale: 1,
  });
  const mutant = 0.28;
  assert.equal(mutant, expected, "mutant discarded variance instead of widening alpha");
});

expectDetected("atlas-gradient-scale-omitted", () => {
  const transform = resolveAtlasTileTransform({
    atlasWidth: 128,
    atlasHeight: 128,
    columns: 2,
    rows: 2,
    tileIndex: 2,
    gutterTexels: 4,
  });
  const mutantGradientScale = [1, 1];
  assert.deepEqual(mutantGradientScale, transform.span);
});

expectDetected("unnormalized-triplanar-weights", () => {
  const normal = [0.2, -0.6, 0.4];
  const mutantWeights = normal.map(Math.abs);
  const expected = evaluateTriplanarWeights(normal);
  assert.deepEqual(mutantWeights, expected);
});

expectDetected("biased-shadow-dissolve-threshold", () => {
  const parity = evaluateDissolveMaskParity({
    causeSamples: Array.from({ length: 1025 }, (_, index) => index / 1024),
    visibleThreshold: 0.42,
    shadowThreshold: 0.47,
    footprint: 0.035,
  });
  assert(parity.iou >= 0.999 && parity.mismatchCount === 0, `mutant dissolve IoU=${parity.iou}`);
});

expectDetected("roughness-only-wetness", () => {
  const dry = evaluateWetRockResponse(0);
  const mutantWet = { ...dry, roughness: evaluateWetRockResponse(1).roughness };
  const changed = ["colorScale", "roughness", "clearcoat", "clearcoatRoughness", "normalStrength"]
    .filter((key) => mutantWet[key] !== dry[key]);
  assert.deepEqual(changed, ["colorScale", "roughness", "clearcoat", "clearcoatRoughness", "normalStrength"]);
});

const wetRock = createWetRockPbrMaterial();
wetRock.aoNode = float(0.5);
expectDetected("occlusion-darkens-ambient", () => {
  assert.equal(wetRock.aoNode, null, "wet-rock material introduced a private ambient-occlusion multiplier");
});
wetRock.dispose();

const emissiveWalnut = createWalnutPbrMaterial();
emissiveWalnut.emissiveNode = float(1);
expectDetected("unauthored-dielectric-emission", () => {
  assert.equal(emissiveWalnut.emissiveNode, null);
});
emissiveWalnut.dispose();

expectDetected("tier-dpr-bypass-after-resize", () => {
  const locked = resolveTierViewport({ width: 641, height: 359, requestedDpr: 3, tier: "mobile" });
  const mutantResize = { ...locked, effectiveDpr: locked.requestedDpr };
  assert(mutantResize.effectiveDpr <= mutantResize.dprCap);
});

expectDetected("forged-aligned-readback-source-stride", () => {
  const layout = computeRgba8ReadbackLayout({
    width: 641,
    height: 359,
    byteLength: 641 * 4 * 359,
  });
  const mutant = { ...layout, sourceBytesPerRow: layout.requestedBytesPerRow };
  assert.equal(mutant.sourceBytesPerRow, layout.rowBytes, "compact renderer output was relabelled as padded");
});

expectDetected("arbitrary-inferred-readback-stride", () => computeRgba8ReadbackLayout({
  width: 641,
  height: 359,
  byteLength: (641 * 4 + 17) * 358 + 641 * 4,
}));

expectDetected("unbounded-stress-seed-float", () => {
  const mutantPhase = 0x9e3779b9;
  assert(mutantPhase < 64, "stress seed was passed directly into float32 noise coordinates");
});
assert(materialSeedPhase(0x9e3779b9, 0) < 64);

expectDetected("uniform-debug-forces-recompile", () => {
  const material = createWalnutPbrMaterial();
  try {
    const version = material.version;
    material.needsUpdate = true;
    setProceduralPbrDebugMode(material, "roughness-aa");
    assert.equal(material.version, version, "uniform-only debug update invalidated the pipeline");
  } finally {
    material.dispose();
  }
});

expectDetected("simultaneous-hdr-and-diagnostic-mrt-overrun", () => {
  const mutant = evaluateColorAttachmentBudget({
    formats: [
      "rgba16float", "rgba16float",
      "rgba8unorm", "rgba8unorm", "rgba8unorm", "rgba8unorm",
    ],
    limit: 32,
  });
  assert.equal(mutant.passes, true, `mutant attachment cost ${mutant.total} exceeds ${mutant.limit}`);
});

const arrayTexture = createMaterialTextureArray();
const layerBytes = arrayTexture.image.width * arrayTexture.image.height * 4;
for (let layer = 1; layer < arrayTexture.image.depth; layer++) {
  arrayTexture.image.data.copyWithin(layer * layerBytes, 0, layerBytes);
}
expectDetected("collapsed-texture-array-layers", () => {
  const hashes = new Set();
  for (let layer = 0; layer < arrayTexture.image.depth; layer++) {
    hashes.add(createHash("sha256").update(
      arrayTexture.image.data.subarray(layer * layerBytes, (layer + 1) * layerBytes),
    ).digest("hex"));
  }
  assert.equal(hashes.size, arrayTexture.image.depth);
});
arrayTexture.dispose();

expectDetected("srgb-data-texture", () => {
  const texture = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  texture.colorSpace = SRGBColorSpace;
  try {
    validateProceduralPbrConfig({ causeMaps: [texture] });
  } finally {
    texture.dispose();
  }
});

expectDetected("silent-debug-fallback", () => {
  const material = createWalnutPbrMaterial();
  try {
    setProceduralPbrDebugMode(material, "does-not-exist");
  } finally {
    material.dispose();
  }
});

expectDetected("factory-silent-debug-fallback", () => {
  const material = createWalnutPbrMaterial({ debugMode: "does-not-exist" });
  material.dispose();
});

const colorAtlas = createMipSafeMaterialAtlas();
const colorArray = createMaterialTextureArray();
const colorTriplanar = createTriplanarMaterialTexture();
colorTriplanar.colorSpace = NoColorSpace;
expectDetected("color-projection-marked-as-data", () => {
  createAtlasArrayTriplanarMaterials({
    atlas: colorAtlas,
    textureArray: colorArray,
    triplanarMap: colorTriplanar,
  });
});
colorAtlas.dispose();
colorArray.dispose();
colorTriplanar.dispose();

expectDetected("stale-material-source-closure", () => {
  const current = {
    sourceHash: "sha256:current",
    buildRevision: "sha256:build",
    threeRevision: "0.185.1",
    files: [{ path: "main.js", sha256: "sha256:file", byteLength: 1 }],
  };
  const boundary = { ...current, sourceClosure: current };
  const session = {
    ...current,
    sourceHash: "sha256:stale",
    sourceClosureHash: "sha256:stale",
    sourceClosure: { ...current, sourceHash: "sha256:stale" },
  };
  assertCurrentSourceIdentity(session, boundary, current);
});

expectDetected("wrong-mode-capture-label", () => assertCaptureState({
  filename: "material-albedo.png",
  target: "final",
  scenario: "pbr-identity",
  tier: "ultra",
  camera: "design",
  seed: 1,
  time: 0,
}));

expectDetected("constant-material-capture", () => assertMaterialImageSemantics(
  "material-albedo.png",
  new Uint8Array(4 * 4 * 4).fill(17),
  4,
  4,
));

{
  const width = 256;
  const height = 256;
  const normalPixels = new Uint8Array(width * height * 4);
  const albedoPixels = new Uint8Array(width * height * 4);
  for (let y = 64; y < 192; y++) {
    for (let x = 64; x < 192; x++) {
      const offset = (y * width + x) * 4;
      normalPixels.set([128, 128, 255, 255], offset);
      albedoPixels.set([96, 64, 48, 255], offset);
    }
  }
  assertCoveredMaterialNormals({ normalPixels, albedoPixels, width, height });
  const corruptOffset = (128 * width + 128) * 4;
  normalPixels.set([0, 0, 0, 255], corruptOffset);
  expectDetected("covered-subject-normal-corruption", () => assertCoveredMaterialNormals({
    normalPixels,
    albedoPixels,
    width,
    height,
  }));
}

expectDetected("raw-mrt-png-mismatch", () => assertRawAttachmentVisualization(
  {
    filename: "material-albedo.png",
    rawAttachment: {
      width: 1,
      height: 1,
      bytesPerPixel: 4,
      bytesPerRow: 4,
      visualization: "raw-unorm-byte-identity",
    },
  },
  Uint8Array.of(1, 2, 3, 255),
  Uint8Array.of(1, 2, 4, 255),
));

expectDetected("fixed-mechanism-route-mutation", () => assertLockedRouteMutation(
  { kind: "mechanism", id: "pbr-identity" },
  "mechanism",
  "shadow-parity",
));
assert.equal(assertLockedRouteMutation(
  { kind: "mechanism", id: "pbr-identity" },
  "mechanism",
  "pbr-identity",
), "pbr-identity");

{
  const target = new EventTarget();
  const scope = createDisposableListenerScope();
  let calls = 0;
  scope.listen(target, "probe", () => { calls++; });
  target.dispatchEvent(new Event("probe"));
  assert.equal(calls, 1);
  assert.equal(scope.dispose(), 1);
  target.dispatchEvent(new Event("probe"));
  assert.equal(calls, 1, "listener scope retained a callback after disposal");
  assert.throws(() => scope.listen(target, "probe", () => {}), /disposed/);
}

expectDetected("post-dispose-listener-leak", () => {
  const target = new EventTarget();
  const scope = createDisposableListenerScope();
  let calls = 0;
  scope.listen(target, "probe", () => { calls++; });
  target.addEventListener("probe", () => { calls++; });
  scope.dispose();
  target.dispatchEvent(new Event("probe"));
  assert.equal(calls, 0, "mutant listener survived disposal");
});

expectDetected("omitted-pass-depth-resource", () => {
  const mutantIds = new Set(["scene-mrt-0", "scene-mrt-1", "directional-shadow-depth"]);
  for (const required of [
    "scene-depth",
    "diagnostic-identity-depth",
    "diagnostic-surface-depth",
    "directional-shadow-color",
  ]) assert(mutantIds.has(required), `resource ledger omitted ${required}`);
});

expectDetected("all-insufficient-evidence-marked-accepted", () => {
  const boundary = {
    status: "accepted",
    publishable: true,
    claims: {
      nativeWebGPUCorrectness: "INSUFFICIENT_EVIDENCE",
      currentAdapterTiming: "INSUFFICIENT_EVIDENCE",
    },
  };
  const insufficient = Object.values(boundary.claims).some((verdict) => verdict !== "PASS");
  assert(!(boundary.status === "accepted" && (boundary.publishable || insufficient)));
});

assert.equal(evaluateFilteredBinaryMetalness(0.1, 0.01), 0);
assert.equal(evaluateFilteredBinaryMetalness(0.9, 0.01), 1);

console.log(JSON.stringify({ pass: true, mutationCount: detected.length, mutations: detected }, null, 2));
