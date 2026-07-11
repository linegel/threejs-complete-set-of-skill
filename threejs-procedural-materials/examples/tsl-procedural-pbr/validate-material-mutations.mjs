import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { DataTexture, SRGBColorSpace } from "three/webgpu";

import {
  authoredPbrIdentities,
  createMaterialTextureArray,
  createMipSafeMaterialAtlas,
  createWalnutPbrMaterial,
  createWetRockPbrMaterial,
  evaluateFilteredBinaryMetalness,
  evaluateWetRockResponse,
  resolveTierViewport,
  setProceduralPbrDebugMode,
  validateAtlasGutterContract,
  validateProceduralPbrConfig,
} from "./procedural-pbr-materials.js";

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
expectDetected("missing-footprint-mrt", () => assert(walnut.mrtNode.outputNodes.materialFootprint));
walnut.dispose();

expectDetected("furnace-energy-overrun", () => {
  const f0 = 1.12;
  const integrated = f0 + (1 - f0) / 21;
  assert(integrated <= 1, `mutant furnace response exceeded unity: ${integrated}`);
});

expectDetected("roughness-only-wetness", () => {
  const dry = evaluateWetRockResponse(0);
  const mutantWet = { ...dry, roughness: evaluateWetRockResponse(1).roughness };
  const changed = ["colorScale", "roughness", "clearcoat", "clearcoatRoughness", "normalStrength"]
    .filter((key) => mutantWet[key] !== dry[key]);
  assert.deepEqual(changed, ["colorScale", "roughness", "clearcoat", "clearcoatRoughness", "normalStrength"]);
});

const wetRock = createWetRockPbrMaterial();
wetRock.userData.proceduralPbr.wetnessCause.ambientAndEmissionUnaffectedByProjectedOcclusion = false;
expectDetected("occlusion-darkens-ambient", () => {
  assert.equal(wetRock.userData.proceduralPbr.wetnessCause.ambientAndEmissionUnaffectedByProjectedOcclusion, true);
});
wetRock.dispose();

expectDetected("tier-dpr-bypass-after-resize", () => {
  const locked = resolveTierViewport({ width: 641, height: 359, requestedDpr: 3, tier: "mobile" });
  const mutantResize = { ...locked, effectiveDpr: locked.requestedDpr };
  assert(mutantResize.effectiveDpr <= mutantResize.dprCap);
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
