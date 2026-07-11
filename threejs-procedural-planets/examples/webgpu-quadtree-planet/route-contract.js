import { PLANET_TIER_IDS } from "./planet-tiers.js";

export const PLANET_SCENARIO_IDS = Object.freeze([
  "field-crater-climate",
  "cross-face-quadtree",
  "balance-and-stitching",
  "field-atlas",
  "solid-body-material",
  "gas-and-ice-giants",
  "orbit-to-surface",
]);

export { PLANET_TIER_IDS } from "./planet-tiers.js";

export function enforcePlanetRouteLocks(route, {
  lockedScenario = null,
  lockedTier = null,
} = {}) {
  if (lockedScenario && !PLANET_SCENARIO_IDS.includes(lockedScenario)) {
    throw new Error(`unknown locked planet scenario "${lockedScenario}"`);
  }
  if (lockedTier && !PLANET_TIER_IDS.includes(lockedTier)) {
    throw new Error(`unknown locked planet tier "${lockedTier}"`);
  }
  if (lockedScenario && route.scenario !== lockedScenario) {
    throw new Error(`route scenario "${route.scenario}" conflicts with locked scenario "${lockedScenario}"`);
  }
  if (lockedTier && route.tier !== lockedTier) {
    throw new Error(`route tier "${route.tier}" conflicts with locked tier "${lockedTier}"`);
  }
  return Object.freeze({ ...route, lockedScenario, lockedTier });
}

export function resolvePlanetRoute(input) {
  const url = input instanceof URL ? input : new URL(input, "http://127.0.0.1");
  const segments = url.pathname.split("/").filter(Boolean);
  const mechanismIndex = segments.lastIndexOf("mechanism");
  const tierIndex = segments.lastIndexOf("tier");
  const scenario = url.searchParams.get("scenario") ??
    (mechanismIndex >= 0 ? segments[mechanismIndex + 1] : "solid-body-material");
  const tier = url.searchParams.get("tier") ??
    (tierIndex >= 0 ? segments[tierIndex + 1] : "balanced");
  if (!PLANET_SCENARIO_IDS.includes(scenario)) {
    throw new Error(`unknown planet scenario "${scenario}"`);
  }
  if (!PLANET_TIER_IDS.includes(tier)) {
    throw new Error(`unknown planet tier "${tier}"`);
  }
  return Object.freeze({ scenario, tier });
}
