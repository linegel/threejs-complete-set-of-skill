export const ASH_SCENARIO_IDS = Object.freeze([
  "structured-growth",
  "leaf-origins-and-normals",
  "forest-storage-and-lod",
  "vegetation-shadow-parity",
  "ash-contract",
  "ash-forest",
]);

export const ASH_TIER_IDS = Object.freeze([
  "growth/hero",
  "growth/forest",
  "growth/background",
]);

export const ASH_RUNTIME_TIER = Object.freeze({
  "growth/hero": "hero",
  "growth/forest": "forest",
  "growth/background": "background",
});

export function resolveAshRoute(input) {
  const url = input instanceof URL ? input : new URL(input, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  const mechanismIndex = parts.lastIndexOf("mechanism");
  const tierIndex = parts.lastIndexOf("tier");
  const scenario = url.searchParams.get("scenario") ??
    (mechanismIndex >= 0 ? parts[mechanismIndex + 1] : "ash-contract");
  const tierSegments = tierIndex >= 0 ? parts.slice(tierIndex + 1, tierIndex + 3) : [];
  const tier = url.searchParams.get("tier") ??
    (tierIndex >= 0 ? tierSegments.join("/") : null);
  if (!ASH_SCENARIO_IDS.includes(scenario)) {
    throw new Error(`unknown Ash scenario "${scenario}"`);
  }
  if (tier !== null && !ASH_TIER_IDS.includes(tier)) {
    throw new Error(`unknown Ash tier "${tier}"`);
  }
  return Object.freeze({ scenario, tier });
}
