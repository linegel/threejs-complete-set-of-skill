import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Color, DataTexture, NoColorSpace, SRGBColorSpace } from "three/webgpu";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { mrt, output, pass, renderOutput } from "three/tsl";

import {
  createAntiqueGoldPbrMaterial,
  createEbonyFramePbrMaterial,
  createLavaEmissivePbrMaterial,
  createWalnutPbrMaterial,
  disposeProceduralPbrMaterial,
  disposeTextureSet,
  proceduralPbrDebugModes,
  setProceduralPbrDebugMode,
  validateProceduralPbrConfig,
} from "./procedural-pbr-materials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetRoot = resolve(__dirname, "../../assets/generated-variants");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readPngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert(signature === "89504e470d0a1a0a", "asset is not a PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer.readUInt8(25),
  };
}

function assertMaterialSlots(name, material, expectedSlots) {
  for (const slot of expectedSlots) {
    assert(material[slot] !== undefined && material[slot] !== null, `${name} missing ${slot}`);
  }
  assert(material.userData.proceduralPbr?.normalVarianceSource === "normalNode", `${name} normal-variance debug must derive from normalNode`);
}

async function validateAssetManifest() {
  const manifest = JSON.parse(await readFile(resolve(assetRoot, "manifest.json"), "utf8"));
  assert(manifest.colorSpace === "NoColorSpace", "manifest must declare NoColorSpace");

  for (const asset of manifest.assets) {
    const buffer = await readFile(resolve(assetRoot, asset.file));
    const hash = createHash("sha256").update(buffer).digest("hex");
    const size = readPngSize(buffer);
    assert(hash === asset.sha256, `${asset.file} hash mismatch`);
    assert(size.width === asset.width && size.height === asset.height, `${asset.file} dimensions mismatch`);
    assert(size.colorType === 6, `${asset.file} must be RGBA PNG`);
    assert(asset.colorSpace === "NoColorSpace", `${asset.file} must declare NoColorSpace`);
  }

  return manifest.assets.map((asset) => asset.file);
}

function validateConfigFailures() {
  const badColorSpaceMap = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  badColorSpaceMap.colorSpace = SRGBColorSpace;
  const failures = [
    { roughnessRange: [0.8, 0.2] },
    { coordinateScale: 0 },
    { seed: Number.NaN },
    { emissionIntensity: 128 },
    { causeMaps: [badColorSpaceMap] },
  ];

  for (const fixture of failures) {
    let failed = false;
    try {
      validateProceduralPbrConfig(fixture);
    } catch {
      failed = true;
    }
    assert(failed, `invalid config unexpectedly passed: ${JSON.stringify(Object.keys(fixture))}`);
  }

  const map = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  map.colorSpace = NoColorSpace;
  assert(validateProceduralPbrConfig({ causeMaps: [map], emissionIntensity: 4 }).pass, "valid config failed");
}

function validateMaterials() {
  assert(typeof bloom === "function", "BloomNode addon import failed");
  assert(typeof mrt === "function" && output && typeof pass === "function" && typeof renderOutput === "function", "TSL pipeline imports failed");

  const walnut = createWalnutPbrMaterial();
  assert(walnut.color.equals(new Color(0x5a2814)), "walnut base color double-converted");
  const gold = createAntiqueGoldPbrMaterial();
  const ebony = createEbonyFramePbrMaterial();
  const lava = createLavaEmissivePbrMaterial();

  assertMaterialSlots("walnut", walnut, ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "maskShadowNode", "clearcoatNode", "clearcoatRoughnessNode"]);
  assertMaterialSlots("gold", gold, ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "maskShadowNode", "clearcoatNode", "clearcoatRoughnessNode"]);
  assertMaterialSlots("ebony", ebony, ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "maskShadowNode", "clearcoatNode", "clearcoatRoughnessNode"]);
  assertMaterialSlots("lava", lava, ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "emissiveNode", "maskShadowNode"]);

  for (const mode of proceduralPbrDebugModes.keys()) {
    assert(setProceduralPbrDebugMode(walnut, mode), `debug mode ${mode} failed`);
  }

  disposeProceduralPbrMaterial(walnut);
  disposeProceduralPbrMaterial(walnut);
  disposeProceduralPbrMaterial(gold);
  disposeProceduralPbrMaterial(ebony);
  disposeProceduralPbrMaterial(lava);

  let disposed = 0;
  const disposable = { dispose: () => { disposed += 1; } };
  disposeTextureSet({ a: disposable, b: null });
  disposeTextureSet({ a: disposable });
  assert(disposed === 2, "disposeTextureSet should be deterministic and null-safe");

  return ["walnut", "antiqueGold", "ebony", "lava"];
}

const result = {
  materials: validateMaterials(),
  config: validateProceduralPbrConfig(),
  configFailures: "passed",
  assets: await validateAssetManifest(),
};
validateConfigFailures();

console.log(JSON.stringify(result, null, 2));
