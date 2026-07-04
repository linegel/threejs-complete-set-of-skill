import { Box3 } from "three";

import { createBuildingPlan, FIXTURE_SETTINGS } from "./building-plan.js";
import { compileBuilding } from "./compiler.js";

const planCache = new Map();

export function planCacheKey(settings) {
  return JSON.stringify({
    name: settings.name,
    seed: settings.seed,
    footprint: settings.footprint,
    qualityTier: settings.qualityTier ?? "hero",
  });
}

export function getCachedPlan(settings) {
  const key = planCacheKey(settings);
  if (planCache.has(key)) return { plan: planCache.get(key), cacheHit: true };
  const plan = createBuildingPlan(settings);
  planCache.set(key, plan);
  return { plan, cacheHit: false };
}

export function compileCityChunk({ fixtureNames = ["single tower", "compound L", "glass-heavy facade"], materials = {} } = {}) {
  const chunkBounds = new Box3();
  chunkBounds.makeEmpty();
  const buildings = [];
  let cacheHits = 0;
  for (const name of fixtureNames) {
    const settings = FIXTURE_SETTINGS.find((fixture) => fixture.name === name) ?? FIXTURE_SETTINGS[0];
    const { plan, cacheHit } = getCachedPlan(settings);
    if (cacheHit) cacheHits += 1;
    const compiled = compileBuilding(plan, materials, { qualityTier: settings.qualityTier ?? "city" });
    chunkBounds.union(compiled.root.userData.diagnostics.bounds ? new Box3().setFromArray([
      ...compiled.root.userData.diagnostics.bounds.min,
      ...compiled.root.userData.diagnostics.bounds.max,
    ]) : new Box3());
    buildings.push({ name, diagnostics: compiled.diagnostics });
  }
  const drawCalls = buildings.reduce((total, building) => total + building.diagnostics.drawCalls, 0);
  const triangles = buildings.reduce(
    (total, building) => total + Object.values(building.diagnostics.triangles).reduce((sum, value) => sum + value, 0),
    0,
  );
  return {
    lodTier: "city",
    drawCalls,
    triangles,
    slots: [...new Set(buildings.flatMap((building) => Object.keys(building.diagnostics.triangles)))],
    bounds: {
      min: chunkBounds.min.toArray(),
      max: chunkBounds.max.toArray(),
    },
    cacheHitCounts: cacheHits,
    buildings,
  };
}
