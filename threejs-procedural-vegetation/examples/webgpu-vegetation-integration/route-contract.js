export const VEGETATION_INTEGRATION_SCENARIO_IDS = Object.freeze([
  "weathered-world-host",
  "creature-habitat-host",
]);

export const VEGETATION_INTEGRATION_MODE_IDS = Object.freeze([
  "final",
  "owner-graph",
  "weather-diagnostics",
  "contact-diagnostics",
]);

export const VEGETATION_INTEGRATION_TIER_IDS = Object.freeze([
  "hero",
  "balanced",
  "budgeted",
]);

export const VEGETATION_INTEGRATION_TIER_CONFIG = Object.freeze({
  hero: Object.freeze({ denseTier: "high", forestCount: 100, dprCap: 2, denseStorageBytes: 37_632_000, ashForestStorageBytes: 3_200 }),
  balanced: Object.freeze({ denseTier: "medium", forestCount: 100, dprCap: 1.5, denseStorageBytes: 12_800_000, ashForestStorageBytes: 3_200 }),
  budgeted: Object.freeze({ denseTier: "low", forestCount: 50, dprCap: 1, denseStorageBytes: 1_728_000, ashForestStorageBytes: 1_600 }),
});

export const VEGETATION_INTEGRATION_MECHANISM_MODE = Object.freeze({
  "host-ownership": "owner-graph",
  "shared-weather": "weather-diagnostics",
  "shared-contacts": "contact-diagnostics",
});

export function resolveVegetationIntegrationRoute(input) {
  const url = input instanceof URL ? input : new URL(input, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  const mechanismIndex = parts.lastIndexOf("mechanism");
  const tierIndex = parts.lastIndexOf("tier");
  const mechanism = mechanismIndex >= 0 ? parts[mechanismIndex + 1] : null;
  if (mechanism !== null && !(mechanism in VEGETATION_INTEGRATION_MECHANISM_MODE)) {
    throw new Error(`unknown vegetation integration mechanism "${mechanism}"`);
  }
  const scenario = url.searchParams.get("scenario") ?? "weathered-world-host";
  const mode = url.searchParams.get("mode") ??
    (mechanism ? VEGETATION_INTEGRATION_MECHANISM_MODE[mechanism] : "final");
  const tier = url.searchParams.get("tier") ??
    (tierIndex >= 0 ? parts[tierIndex + 1] : "balanced");
  const camera = url.searchParams.get("camera") ?? "host-camera";
  const seedText = url.searchParams.get("seed");
  const seed = seedText === null ? 1 : Number(seedText);
  if (!VEGETATION_INTEGRATION_SCENARIO_IDS.includes(scenario)) {
    throw new Error(`unknown vegetation integration scenario "${scenario}"`);
  }
  if (!VEGETATION_INTEGRATION_MODE_IDS.includes(mode)) {
    throw new Error(`unknown vegetation integration mode "${mode}"`);
  }
  if (!VEGETATION_INTEGRATION_TIER_IDS.includes(tier)) {
    throw new Error(`unknown vegetation integration tier "${tier}"`);
  }
  if (camera !== "host-camera") throw new Error(`unknown vegetation integration camera "${camera}"`);
  if (![1, 0x9e3779b9].includes(seed)) throw new Error(`unknown vegetation integration seed "${seedText}"`);
  return Object.freeze({ scenario, mode, tier, camera, seed, mechanism });
}
