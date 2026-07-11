export const DENSE_GRASS_SCENARIO_IDS = Object.freeze([
  "dense-grass-placement",
  "dense-grass-wind-and-trampling",
  "dense-grass-lod-and-impostors",
  "uniform-density",
  "mask-a",
  "mask-b",
  "mask-c",
]);

export const DENSE_GRASS_TIER_IDS = Object.freeze([
  "dense/ultra",
  "dense/high",
  "dense/medium",
  "dense/low",
]);

export const DENSE_GRASS_RUNTIME_TIER = Object.freeze({
  "dense/ultra": "ultra",
  "dense/high": "high",
  "dense/medium": "medium",
  "dense/low": "low",
});

export function resolveDenseGrassRoute(input) {
  const url = input instanceof URL ? input : new URL(input, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  const mechanismIndex = parts.lastIndexOf("mechanism");
  const tierIndex = parts.lastIndexOf("tier");
  const scenario = url.searchParams.get("scenario") ??
    (mechanismIndex >= 0 ? parts[mechanismIndex + 1] : "uniform-density");
  const tierSegments = tierIndex >= 0 ? parts.slice(tierIndex + 1, tierIndex + 3) : [];
  const tier = url.searchParams.get("tier") ??
    (tierIndex >= 0 ? tierSegments.join("/") : "dense/medium");
  if (!DENSE_GRASS_SCENARIO_IDS.includes(scenario)) {
    throw new Error(`unknown dense-grass scenario "${scenario}"`);
  }
  if (!DENSE_GRASS_TIER_IDS.includes(tier)) {
    throw new Error(`unknown dense-grass tier "${tier}"`);
  }
  return Object.freeze({ scenario, tier });
}
