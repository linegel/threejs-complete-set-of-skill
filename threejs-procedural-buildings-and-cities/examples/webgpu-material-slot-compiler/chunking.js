import { Box3, Group, Vector3 } from "three";

import { createBuildingPlan, FIXTURE_SETTINGS } from "./building-plan.js";
import { compileBuilding, disposeCompiledBuilding } from "./compiler.js";

const planCache = new Map();

export function planCacheKey(settings) {
  return JSON.stringify(Object.fromEntries(Object.entries({
    name: settings.name,
    seed: settings.seed,
    footprint: settings.footprint,
    qualityTier: settings.qualityTier ?? "hero",
    widthBays: settings.widthBays ?? null,
    depthBays: settings.depthBays ?? null,
    floors: settings.floors ?? null,
    podiumFloors: settings.podiumFloors ?? null,
    ornamentDensity: settings.ornamentDensity ?? null,
    glassHeavy: settings.glassHeavy ?? false,
  }).sort(([a], [b]) => a.localeCompare(b))));
}

export function getCachedPlan(settings) {
  const key = planCacheKey(settings);
  if (planCache.has(key)) return { plan: structuredClone(planCache.get(key)), cacheHit: true };
  const plan = createBuildingPlan(settings);
  planCache.set(key, structuredClone(plan));
  return { plan, cacheHit: false };
}

export function clearPlanCache() {
  planCache.clear();
}

export function validateChunkCulling(chunks, state) {
  const visible = chunks.filter((chunk) => chunk.root.visible);
  const errors = [];
  if (state.visibleChunks !== visible.length) errors.push("visible chunk count mismatch");
  if (state.culledChunks !== chunks.length - visible.length) errors.push("culled chunk count mismatch");
  if (state.submittedTriangles !== visible.reduce((sum, chunk) => sum + chunk.triangles, 0)) errors.push("submitted triangle mismatch");
  if (state.submittedDrawItems !== visible.reduce((sum, chunk) => sum + chunk.drawItems, 0)) errors.push("submitted draw-item mismatch");
  if (state.submittedDrawCalls !== visible.reduce((sum, chunk) => sum + chunk.drawCalls, 0)) errors.push("submitted draw-call mismatch");
  if (JSON.stringify(state.visibleChunkIds) !== JSON.stringify(visible.map((chunk) => chunk.id))) errors.push("visible chunk id mismatch");
  return { ok: errors.length === 0, errors };
}

export function compileCityChunk({
  fixtureNames = ["single tower", "compound L", "glass-heavy facade"],
  materials = {},
  qualityTier = "city",
  spacing = 46,
  preferBatchedMesh = false,
} = {}) {
  const root = new Group();
  root.name = "procedural-city-chunk";
  const compiledBuildings = [];
  let cacheHits = 0;
  const columns = Math.max(1, Math.ceil(Math.sqrt(fixtureNames.length)));
  for (const [index, name] of fixtureNames.entries()) {
    const settings = FIXTURE_SETTINGS.find((fixture) => fixture.name === name) ?? FIXTURE_SETTINGS[0];
    const { plan, cacheHit } = getCachedPlan({ ...settings, qualityTier });
    if (cacheHit) cacheHits += 1;
    const compiled = compileBuilding(plan, materials, { qualityTier, preferBatchedMesh });
    const column = index % columns;
    const row = Math.floor(index / columns);
    compiled.root.position.set((column - (columns - 1) / 2) * spacing, 0, row * spacing);
    compiled.root.updateMatrixWorld(true);
    root.add(compiled.root);
    compiledBuildings.push({ name, plan, compiled });
  }
  root.updateMatrixWorld(true);
  const chunkBounds = new Box3().setFromObject(root);
  const drawCalls = compiledBuildings.reduce((total, entry) => total + entry.compiled.diagnostics.drawCalls, 0);
  const backendDrawItems = compiledBuildings.reduce((total, entry) => total + entry.compiled.diagnostics.backendDrawItems, 0);
  const triangles = compiledBuildings.reduce(
    (total, entry) => total + Object.values(entry.compiled.diagnostics.triangles).reduce((sum, value) => sum + value, 0),
    0,
  );
  const chunks = compiledBuildings.map((entry) => ({
    id: entry.name,
    root: entry.compiled.root,
    bounds: new Box3().setFromObject(entry.compiled.root),
    triangles: Object.values(entry.compiled.diagnostics.triangles).reduce((sum, value) => sum + value, 0),
    drawItems: entry.compiled.diagnostics.backendDrawItems,
    drawCalls: entry.compiled.diagnostics.drawCalls,
  }));
  let cullingState = {
    sourceChunks: chunks.length,
    visibleChunks: chunks.length,
    culledChunks: 0,
    submittedTriangles: triangles,
    submittedDrawItems: backendDrawItems,
    submittedDrawCalls: drawCalls,
    visibleChunkIds: chunks.map((chunk) => chunk.id),
  };

  return {
    root,
    lodTier: qualityTier,
    drawCalls,
    backendDrawItems,
    triangles,
    slots: [...new Set(compiledBuildings.flatMap((entry) => Object.keys(entry.compiled.diagnostics.triangles).filter((slot) => entry.compiled.diagnostics.triangles[slot] > 0)))],
    bounds: { min: chunkBounds.min.toArray(), max: chunkBounds.max.toArray() },
    cacheHitCounts: cacheHits,
    buildings: compiledBuildings.map((entry) => ({ name: entry.name, diagnostics: entry.compiled.diagnostics })),
    chunks,
    cullByRadius(center, radius) {
      if (!Array.isArray(center) || center.length !== 3 || !(radius >= 0)) throw new RangeError("culling sphere is invalid");
      const point = new Vector3(...center);
      const visible = [];
      for (const chunk of chunks) {
        const isVisible = chunk.bounds.distanceToPoint(point) <= radius;
        chunk.root.visible = isVisible;
        if (isVisible) visible.push(chunk);
      }
      cullingState = {
        sourceChunks: chunks.length,
        visibleChunks: visible.length,
        culledChunks: chunks.length - visible.length,
        submittedTriangles: visible.reduce((sum, chunk) => sum + chunk.triangles, 0),
        submittedDrawItems: visible.reduce((sum, chunk) => sum + chunk.drawItems, 0),
        submittedDrawCalls: visible.reduce((sum, chunk) => sum + chunk.drawCalls, 0),
        visibleChunkIds: visible.map((chunk) => chunk.id),
      };
      return { ...cullingState };
    },
    getCullingState() {
      return { ...cullingState, visibleChunkIds: [...cullingState.visibleChunkIds] };
    },
    resetCulling() {
      for (const chunk of chunks) chunk.root.visible = true;
      cullingState = {
        sourceChunks: chunks.length,
        visibleChunks: chunks.length,
        culledChunks: 0,
        submittedTriangles: triangles,
        submittedDrawItems: backendDrawItems,
        submittedDrawCalls: drawCalls,
        visibleChunkIds: chunks.map((chunk) => chunk.id),
      };
      return { ...cullingState, visibleChunkIds: [...cullingState.visibleChunkIds] };
    },
    dispose() {
      for (const entry of compiledBuildings) disposeCompiledBuilding(entry.compiled);
      root.clear();
    },
  };
}
