import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  WEATHERED_WORLD_CAMERAS,
  WEATHERED_WORLD_MODES,
  WEATHERED_WORLD_TIERS,
  WORLD_UNITS_PER_METER,
  validateWeatheredWorldContract,
} from "./world-contract.js";
import { INTEGRATION_REASON, validateIntegrationContract } from "../shared/integration-contract-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(name) {
  return JSON.parse(await readFile(resolve(here, name), "utf8"));
}

function equalArray(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} drifted from the executable contract`);
}

export async function validateWeatheredWorldStatic() {
  const [manifest, contract, browserSource, stageSource] = await Promise.all([
    json("lab.manifest.json"),
    json("contract.json"),
    readFile(resolve(here, "browser-app.js"), "utf8"),
    readFile(resolve(here, "world-stages.js"), "utf8"),
  ]);

  assert(manifest.schemaVersion === 2 && contract.schemaVersion === 2, "Weathered World requires schema v2");
  assert(manifest.id === "weathered-world" && contract.id === manifest.id, "Weathered World IDs must agree");
  assert(manifest.kind === "integration-demo", "Weathered World must remain an integration-demo");
  assert(manifest.status === "incomplete" && contract.status === "incomplete", "Known runtime P0s require incomplete status");
  equalArray(manifest.modes, WEATHERED_WORLD_MODES, "manifest modes");
  equalArray(contract.modes, WEATHERED_WORLD_MODES, "contract modes");
  equalArray(manifest.cameras, WEATHERED_WORLD_CAMERAS, "manifest cameras");
  equalArray(contract.cameras, WEATHERED_WORLD_CAMERAS, "contract cameras");
  equalArray(manifest.tiers.map((tier) => tier.id), Object.keys(WEATHERED_WORLD_TIERS), "manifest tiers");
  equalArray(contract.tiers.map((tier) => tier.id), Object.keys(WEATHERED_WORLD_TIERS), "contract tiers");
  const integrationValidation = validateIntegrationContract(contract);
  assert(integrationValidation.verdict === "PASS" && integrationValidation.code === INTEGRATION_REASON.INCOMPLETE, integrationValidation.message);

  assert(WORLD_UNITS_PER_METER === 1, "Weathered World freezes one world unit per metre");
  const core = validateWeatheredWorldContract();
  assert(core.ok, core.errors.join("\n"));

  for (const tierRecord of contract.tiers) {
    const runtimeTier = WEATHERED_WORLD_TIERS[tierRecord.id];
    const sum = tierRecord.stageBudgets.reduce((total, stage) => {
      const datum = stage.budgetMs;
      assert(datum.label === "Gated" && datum.unit === "ms" && Number.isFinite(datum.value), `${tierRecord.id} stage budget lacks numeric provenance`);
      return total + datum.value;
    }, 0);
    assert(sum <= tierRecord.targetFrameMs.value + 1e-9, `${tierRecord.id} stage budgets exceed targetFrameMs`);
    assert(tierRecord.resolutionPolicy.cloudScale === runtimeTier.cloudScale, `${tierRecord.id} cloud scale is not the executed canonical tier scale`);
    assert(tierRecord.resolutionPolicy.sceneScale === runtimeTier.sceneScale, `${tierRecord.id} scene scale is not executed`);
    assert(tierRecord.resolutionPolicy.dprCap === runtimeTier.dprCap, `${tierRecord.id} DPR cap is not executed`);
    assert(!Object.hasOwn(manifest.tiers.find((tier) => tier.id === tierRecord.id), "route"), `${tierRecord.id} contains forbidden tier.route`);
  }

  const adapterStatuses = contract.adapterRequirements.map((adapter) => adapter.sourceStatus);
  assert(adapterStatuses.every((status) => status === "available"), "Weathered World still declares a missing adapter");
  assert(Object.values(contract.runtimeEvidence).every((verdict) => verdict === "INSUFFICIENT_EVIDENCE"), "Uncaptured runtime evidence cannot pass");

  assert((browserSource.match(/new WebGPURenderer\s*\(/g) ?? []).length === 1, "Weathered World requires exactly one renderer construction");
  assert((browserSource.match(/new RenderPipeline\s*\(/g) ?? []).length === 1, "Weathered World requires exactly one RenderPipeline construction");
  assert(!stageSource.includes("new WebGPURenderer"), "Imported stages cannot construct a renderer");
  assert(!stageSource.includes("new RenderPipeline"), "Imported stages cannot construct a RenderPipeline");
  assert(!browserSource.includes("WebGLRenderer") && !stageSource.includes("WebGLRenderer"), "Canonical integration cannot contain a WebGL fallback");
  for (const token of [
    "await renderer.init()",
    "isWebGPUBackend",
    "pipeline.outputColorTransform = false",
    "scenePass.setMRT(mrt({ output }))",
    "unpackAlignedReadback",
    "Opaque-shadow diagnostic requires the real allocated shadow comparison target",
    "createDepthAwareCloudCompositeNode",
    "new URLSearchParams(location.search)",
    "queryMechanism",
    "const finalHdr = cloudComposite",
  ]) assert(browserSource.includes(token), `browser-app.js is missing required runtime token: ${token}`);
  for (const token of [
    "createPlanetSceneAdapter",
    "createAtmosphereStage",
    "deriveAtmosphereRuntimeState",
    "createWeatherCloudStage",
    "createSpectralOceanStage",
    "createBoundedWaterStage",
    "createSharedWeatherStage",
    "createPrecipitationStage",
    "createWeatherSurfaceResponseStage",
    "createDenseVegetationSceneAdapter",
    "dispatchCloudFrame",
    "sceneDepthTexture",
    "cloud.dispatchFrame",
    "sampleCloudShadowTransmission",
    "cloudShadowConsumers.planet",
    "cloudShadowConsumers.ocean",
    "cloudShadowConsumers.vegetation",
  ]) assert(stageSource.includes(token), `world-stages.js is missing adapter token: ${token}`);
  assert(!stageSource.includes("createSceneDepthInitializeNode"), "Weathered World must not fabricate constant cloud scene depth");
  assert(!stageSource.includes("createPlanetHostAdapter"), "Weathered World must use the canonical planet adapter");
  assert(!stageSource.includes("createPrecipitationVisual"), "Weathered World must use canonical precipitation stages");
  assert(!browserSource.includes("weatherDrivenTransmittance"), "Weathered World must compose exactly sceneHDR*T+cloudRadiance");

  for (const mode of WEATHERED_WORLD_MODES) {
    const html = await readFile(resolve(here, "mode", mode, "index.html"), "utf8");
    assert(html.includes(`name="locked-mode" content="${mode}"`), `mode/${mode}/ does not lock the exact mode`);
    assert(html.includes("../../browser-app.js"), `mode/${mode}/ forks the canonical implementation`);
  }
  const expectedMechanisms = [
    "shared-world-units",
    "shared-weather-envelope",
    "atmosphere-cloud-hdr",
    "ocean-bounded-water-ownership",
    "cloud-opaque-shadow-separation",
    "owner-graph",
  ];
  equalArray(manifest.mechanisms.map((mechanism) => mechanism.id), expectedMechanisms, "manifest mechanisms");
  for (const mechanism of manifest.mechanisms) {
    const html = await readFile(resolve(here, "mechanism", mechanism.id, "index.html"), "utf8");
    assert(html.includes(`name="locked-mode" content="${mechanism.startup.mode}"`), `mechanism/${mechanism.id}/ does not lock ${mechanism.startup.mode}`);
    assert(html.includes("../../browser-app.js"), `mechanism/${mechanism.id}/ forks the canonical implementation`);
  }
  for (const tier of Object.keys(WEATHERED_WORLD_TIERS)) {
    const html = await readFile(resolve(here, "tier", tier, "index.html"), "utf8");
    assert(html.includes(`name="locked-tier" content="${tier}"`), `tier/${tier}/ does not lock the exact tier`);
    assert(html.includes("../../browser-app.js"), `tier/${tier}/ forks the canonical implementation`);
  }

  return {
    modes: WEATHERED_WORLD_MODES.length,
    tiers: Object.keys(WEATHERED_WORLD_TIERS).length,
    cameras: WEATHERED_WORLD_CAMERAS.length,
    mechanisms: expectedMechanisms.length,
    status: "incomplete-pending-runtime-evidence",
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await validateWeatheredWorldStatic();
  console.log(`Weathered World static validation passed: ${JSON.stringify(result)}`);
}
