import {
  DISTRICT_MECHANISM_MODES,
  requireDistrictCamera,
  requireDistrictMechanism,
  requireDistrictMode,
  requireDistrictScenario,
  requireDistrictSeed,
  requireDistrictTier,
} from "./district-contract.js";

function segments(pathname) {
  return String(pathname).split("/").filter(Boolean);
}

function routeValue(parts, kind) {
  const index = parts.lastIndexOf(kind);
  if (index < 0) return null;
  const value = parts[index + 1];
  if (!value) throw new Error(`District ${kind} route is missing an id.`);
  return value;
}

export function resolveDistrictRoute(pathname = "/", search = "", locks = {}) {
  const parts = segments(pathname);
  const params = new URLSearchParams(search);
  const mechanismRoute = routeValue(parts, "mechanism");
  const tierRoute = routeValue(parts, "tier");
  const modeRoute = routeValue(parts, "mode");
  const mechanismQuery = params.get("mechanism");
  const scenarioQuery = params.get("scenario");
  const tierQuery = params.get("tier");
  const modeQuery = params.get("mode");
  if (mechanismRoute) requireDistrictMechanism(mechanismRoute);
  if (mechanismQuery) requireDistrictMechanism(mechanismQuery);
  if (scenarioQuery) requireDistrictScenario(scenarioQuery);
  if (tierQuery) requireDistrictTier(tierQuery);
  if (modeQuery) requireDistrictMode(modeQuery);

  const mechanism = locks.mechanism ?? mechanismRoute ?? mechanismQuery ?? null;
  if (mechanism) requireDistrictMechanism(mechanism);
  const scenario = locks.scenario ?? scenarioQuery ?? "district";
  const tier = locks.tier ?? tierRoute ?? tierQuery ?? "balanced";
  const mechanismMode = mechanism ? DISTRICT_MECHANISM_MODES[mechanism] : null;
  const mode = locks.mode ?? modeRoute ?? mechanismMode ?? modeQuery ?? "final";
  const camera = locks.camera ?? params.get("camera") ?? "district";
  const seedText = locks.seed ?? params.get("seed") ?? "1";
  const timeText = locks.time ?? params.get("time") ?? "0";
  const seed = Number(seedText);
  const time = Number(timeText);

  requireDistrictScenario(scenario);
  requireDistrictTier(tier);
  requireDistrictMode(mode);
  requireDistrictCamera(camera);
  requireDistrictSeed(seed);
  if (!Number.isFinite(time) || time < 0) throw new RangeError(`Invalid district time: ${timeText}`);

  if (mechanism && mode !== mechanismMode) {
    throw new Error(`District mechanism ${mechanism} requires mode ${mechanismMode}; received ${mode}.`);
  }

  const routeLocks = Object.freeze({
    ...(locks.scenario != null || scenarioQuery != null ? { scenario } : {}),
    ...(locks.tier != null || tierRoute != null || tierQuery != null ? { tier } : {}),
    ...(locks.mode != null || modeRoute != null || mechanism != null || modeQuery != null ? { mode } : {}),
    ...(mechanism != null ? { mechanism } : {}),
  });
  return { scenario, tier, mode, camera, seed: seed >>> 0, time, mechanism, routeLocks };
}
