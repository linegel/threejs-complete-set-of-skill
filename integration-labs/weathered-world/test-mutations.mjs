import {
  WEATHERED_WORLD_SIGNALS,
  WEATHERED_WORLD_TIERS,
  requireWeatheredWorldCamera,
  requireWeatheredWorldMode,
  requireWeatheredWorldTier,
  validateWeatheredWorldContract,
} from "./world-contract.js";

const here = dirname(fileURLToPath(import.meta.url));

function expectKilled(id, mutate, fragment) {
  const result = validateWeatheredWorldContract(mutate());
  if (result.ok || !result.errors.some((error) => error.includes(fragment))) {
    throw new Error(`Mutation ${id} survived: ${JSON.stringify(result.errors)}`);
  }
  return id;
}

const sharedWeather = {};
const killed = [
  expectKilled("duplicate-output-owner", () => ({ owners: { renderer: ["a", "b"] } }), "duplicate owners"),
  expectKilled("unit-drift", () => ({ stageWorldUnits: { atmosphere: 0.001 } }), "differs from"),
  expectKilled("radius-drift", () => ({ sharedSurfaceRadiusMeters: 6360000, stageSurfaceRadii: { atmosphere: 6360001 } }), "surface radius"),
  expectKilled("private-weather", () => ({ sharedWeatherEnvelope: sharedWeather, stageWeatherEnvelopes: { clouds: {} } }), "private weather envelope"),
  expectKilled("collapsed-shadow-domains", () => ({ owners: { cloudOpticalShadow: "same", opaqueShadow: "same" } }), "separate owners"),
  expectKilled("collapsed-water-domains", () => ({ owners: { unboundedWater: "same", boundedWater: "same" } }), "separate owners"),
  expectKilled("duplicate-signal", () => ({ signals: [...WEATHERED_WORLD_SIGNALS, WEATHERED_WORLD_SIGNALS[0]] }), "duplicate signal"),
  expectKilled("unknown-signal-producer", () => ({ signals: [{ id: "bad", producer: "private-stage", consumers: [] }] }), "not a declared owner"),
  expectKilled("over-budget-tier", () => ({ tier: { ...WEATHERED_WORLD_TIERS.hero, stageBudgetMs: { impossible: 17 } } }), "exceeds 16.67"),
  expectKilled("split-final-owner", () => ({ owners: { renderer: "a", renderPipeline: "b", toneMap: "c", outputTransform: "d" } }), "must share"),
];

for (const [id, invoke] of [
  ["unknown-mode", () => requireWeatheredWorldMode("not-a-mode")],
  ["unknown-tier", () => requireWeatheredWorldTier("not-a-tier")],
  ["unknown-camera", () => requireWeatheredWorldCamera("not-a-camera")],
]) {
  let threw = false;
  try { invoke(); } catch { threw = true; }
  if (!threw) throw new Error(`Mutation ${id} survived silent fallback`);
  killed.push(id);
}

const sourceBundle = {
  browser: await readFile(resolve(here, "browser-app.js"), "utf8"),
  stages: await readFile(resolve(here, "world-stages.js"), "utf8"),
};
function sourceErrors(bundle) {
  const required = [
    ["browser", "new URLSearchParams(location.search)", "query route parser"],
    ["browser", "queryMechanism", "mechanism query lock"],
    ["browser", "const lockedTier = metaLockedTier ?? queryTier", "tier query lock"],
    ["browser", "const finalHdr = cloudComposite", "exact HDR cloud composition"],
    ["stages", "createPlanetSceneAdapter", "canonical planet adapter"],
    ["stages", "deriveAtmosphereRuntimeState", "live atmosphere host state"],
    ["stages", "sampleCloudShadowTransmission", "cloud receiver shadow sampling"],
    ["stages", "cloudShadowConsumers.planet", "planet cloud-shadow consumer"],
    ["stages", "cloudShadowConsumers.ocean", "ocean cloud-shadow consumer"],
    ["stages", "cloudShadowConsumers.vegetation", "vegetation cloud-shadow consumer"],
    ["stages", "createPrecipitationStage", "canonical precipitation adapter"],
    ["stages", "createWeatherSurfaceResponseStage", "canonical wet/snow surface adapter"],
  ];
  const errors = [];
  for (const [file, token, label] of required) if (!bundle[file].includes(token)) errors.push(label);
  for (const [file, token, label] of [
    ["browser", "weatherDrivenTransmittance", "ad hoc cloud transmittance"],
    ["stages", "createPlanetHostAdapter", "local plane planet proxy"],
    ["stages", "createPrecipitationVisual", "local precipitation proxy"],
    ["stages", "createSceneDepthInitializeNode", "fabricated cloud depth"],
  ]) if (bundle[file].includes(token)) errors.push(label);
  return errors;
}
if (sourceErrors(sourceBundle).length > 0) throw new Error(`Weathered World source contract failed: ${sourceErrors(sourceBundle).join(", ")}`);
for (const [file, token] of [
  ["browser", "new URLSearchParams(location.search)"],
  ["browser", "queryMechanism"],
  ["browser", "const finalHdr = cloudComposite"],
  ["stages", "createPlanetSceneAdapter"],
  ["stages", "deriveAtmosphereRuntimeState"],
  ["stages", "sampleCloudShadowTransmission"],
  ["stages", "cloudShadowConsumers.planet"],
  ["stages", "cloudShadowConsumers.ocean"],
  ["stages", "cloudShadowConsumers.vegetation"],
  ["stages", "createPrecipitationStage"],
  ["stages", "createWeatherSurfaceResponseStage"],
]) {
  const mutant = { ...sourceBundle, [file]: sourceBundle[file].split(token).join("__MUTATED__") };
  if (sourceErrors(mutant).length === 0) throw new Error(`Mutation ${file}:${token} survived`);
  killed.push(`source-${token}`);
}

console.log(`Weathered World mutation suite killed ${killed.length} mutations: ${killed.join(", ")}`);
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
