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
  initializeProceduralPbrMaterialData,
  PROCEDURAL_PBR_WEBGPU_REQUIRED_MESSAGE,
  proceduralPbrDebugModes,
  setProceduralPbrDebugMode,
  validateProceduralPbrConfig,
} from "./procedural-pbr-materials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetRoot = resolve(__dirname, "../../assets/generated-variants");
const materialSourcePath = resolve(__dirname, "procedural-pbr-materials.js");

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

async function validateSourceGuards() {
  const source = await readFile(materialSourcePath, "utf8");
  assert(!/\bbumpMap\s*\(/.test(source), "scalar procedural height must not be routed through bumpMap()");
  assert(source.includes("function createDerivativeNormalFromHeight"), "missing scalar-height derivative normal helper");
  assert(source.includes("scaledHeight.dFdx()") && source.includes("scaledHeight.dFdy()"), "derivative normal must consume height screen-space derivatives");
  assert(source.includes("positionView.dFdx()") && source.includes("normalView"), "derivative normal must use r185 view-space surface-gradient inputs");
  return "passed";
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
  const materials = { walnut, gold, ebony, lava };

  assertMaterialSlots("walnut", walnut, ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "maskShadowNode", "clearcoatNode", "clearcoatRoughnessNode"]);
  assertMaterialSlots("gold", gold, ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "maskShadowNode", "clearcoatNode", "clearcoatRoughnessNode"]);
  assertMaterialSlots("ebony", ebony, ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "maskShadowNode", "clearcoatNode", "clearcoatRoughnessNode"]);
  assertMaterialSlots("lava", lava, ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "emissiveNode", "maskShadowNode"]);

  for (const [name, material] of Object.entries(materials)) {
    for (const mode of proceduralPbrDebugModes.keys()) {
      assert(setProceduralPbrDebugMode(material, mode), `${name} debug mode ${mode} failed`);
    }
  }

  let materialDisposeCount = 0;
  walnut.dispose = () => { materialDisposeCount += 1; };
  assert(disposeProceduralPbrMaterial(walnut), "first material dispose should report work");
  assert(!disposeProceduralPbrMaterial(walnut), "second material dispose should be idempotent");
  assert(materialDisposeCount === 1, "disposeProceduralPbrMaterial must dispose once over repeated calls");
  disposeProceduralPbrMaterial(gold);
  disposeProceduralPbrMaterial(ebony);
  disposeProceduralPbrMaterial(lava);

  let disposed = 0;
  const disposable = { dispose: () => { disposed += 1; } };
  const textureSet = { a: disposable, b: null };
  assert(disposeTextureSet(textureSet) === 1, "disposeTextureSet should dispose one live texture");
  assert(disposeTextureSet(textureSet) === 0, "disposeTextureSet should clear entries and be idempotent");
  assert(disposed === 1, "disposeTextureSet must dispose once over repeated calls");

  return ["walnut", "antiqueGold", "ebony", "lava"];
}

async function validateCapabilityGate() {
  let computeCalls = 0;
  let restoredTarget = false;
  const webgpuRenderer = {
    backend: { isWebGPUBackend: true },
    getRenderTarget: () => "previous-target",
    setRenderTarget: (target) => {
      restoredTarget = target === "previous-target";
    },
    init: async () => {},
    computeAsync: async (nodes) => {
      computeCalls = nodes.length;
    },
  };
  const pass = await initializeProceduralPbrMaterialData(webgpuRenderer, { computeNodes: ["cause-map", "instance-state"] });
  assert(pass.isWebGPUBackend === true && pass.computeNodeCount === 2, "native WebGPU capability gate failed");
  assert(computeCalls === 2, "compute nodes were not dispatched on native WebGPU");
  assert(restoredTarget, "capability helper must restore render target");

  let rejected = false;
  let nonWebgpuRestoredTarget = false;
  const nonWebgpuRenderer = {
    backend: { isWebGPUBackend: false },
    getRenderTarget: () => "old-target",
    setRenderTarget: (target) => {
      nonWebgpuRestoredTarget = target === "old-target";
    },
    init: async () => {},
    computeAsync: async () => {
      throw new Error("compute should not run on non-WebGPU");
    },
  };
  try {
    await initializeProceduralPbrMaterialData(nonWebgpuRenderer, { computeNodes: ["unused"] });
  } catch (error) {
    rejected = error.message === PROCEDURAL_PBR_WEBGPU_REQUIRED_MESSAGE;
  }
  assert(rejected, "non-WebGPU backend must throw with fallback-routing message");
  assert(nonWebgpuRestoredTarget, "non-WebGPU rejection must still restore render target");
  return "passed";
}

const result = {
  materials: validateMaterials(),
  config: validateProceduralPbrConfig(),
  configFailures: "passed",
  sourceGuards: await validateSourceGuards(),
  capabilityGate: await validateCapabilityGate(),
  assets: await validateAssetManifest(),
};
validateConfigFailures();

console.log(JSON.stringify(result, null, 2));
