export const MATERIAL_SLOTS = Object.freeze([
  "limestone",
  "granite",
  "terra-cotta",
  "glass",
  "bronze",
  "black-metal",
  "ornament",
  "roof",
]);

function module(id, slot, {
  constructionDepth,
  uvMetersPerRepeat = 1.45,
  triangleBudget = 12,
  anchors = {},
  build,
} = {}) {
  if (!(constructionDepth > 0)) throw new Error(`${id} requires positive constructionDepth`);
  return Object.freeze({
    id,
    slot,
    localFrame: "facade-x-right-y-up-z-out",
    constructionDepth,
    uvMetersPerRepeat,
    triangleBudget,
    anchors: Object.freeze({ center: [0, 0, 0], ...anchors }),
    build(context) {
      if (context.placement.moduleId !== id) throw new Error(`module context mismatch for ${id}`);
      const start = context.writer.triangleCount;
      build(context);
      const triangles = context.writer.triangleCount - start;
      if (triangles <= 0) throw new Error(`${id} emitted no triangles`);
      if (triangles > triangleBudget) {
        throw new Error(`${id} emitted ${triangles} triangles above authored budget ${triangleBudget}`);
      }
      return { moduleId: id, slot, triangles, constructionDepth, uvMetersPerRepeat };
    },
  });
}

const box = (context) => context.emitBox({
  width: context.width,
  height: context.height,
  depth: context.depth,
});

export const MODULE_REGISTRY = Object.freeze({
  plinth: module("plinth", "granite", {
    constructionDepth: 0.42,
    triangleBudget: 12,
    build: box,
  }),
  facadePanel: module("facadePanel", "limestone", {
    constructionDepth: 0.34,
    triangleBudget: 12,
    build: box,
  }),
  window: module("window", "glass", {
    constructionDepth: 0.18,
    uvMetersPerRepeat: 1.2,
    triangleBudget: 12,
    build: box,
  }),
  archedWindow: module("archedWindow", "terra-cotta", {
    constructionDepth: 0.24,
    uvMetersPerRepeat: 1.2,
    triangleBudget: 68,
    build: (context) => context.emitArch({ radialSegments: context.qualityTier === "hero" ? 10 : 6 }),
  }),
  glassShaft: module("glassShaft", "glass", {
    constructionDepth: 0.22,
    uvMetersPerRepeat: 1.2,
    triangleBudget: 12,
    build: box,
  }),
  door: module("door", "bronze", {
    constructionDepth: 0.32,
    uvMetersPerRepeat: 1.0,
    triangleBudget: 12,
    build: box,
  }),
  loadingDock: module("loadingDock", "black-metal", {
    constructionDepth: 0.48,
    uvMetersPerRepeat: 1.2,
    triangleBudget: 12,
    build: box,
  }),
  cornerPier: module("cornerPier", "limestone", {
    constructionDepth: 0.62,
    triangleBudget: 12,
    build: box,
  }),
  cornice: module("cornice", "ornament", {
    constructionDepth: 0.58,
    triangleBudget: 36,
    build: (context) => {
      for (const [layer, depthScale] of [[0, 0.72], [1, 1], [2, 0.82]]) {
        context.emitBox({
          width: context.width,
          height: context.height / 3,
          depth: context.depth * depthScale,
          center: [0, -context.height / 3 + (layer + 0.5) * context.height / 3, 0],
        });
      }
    },
  }),
  ornamentPanel: module("ornamentPanel", "ornament", {
    constructionDepth: 0.4,
    triangleBudget: 68,
    build: (context) => context.emitArch({ radialSegments: context.qualityTier === "hero" ? 10 : 6 }),
  }),
  pediment: module("pediment", "ornament", {
    constructionDepth: 0.5,
    triangleBudget: 8,
    build: (context) => context.emitTriangularPrism(),
  }),
  massDeck: module("massDeck", "limestone", {
    constructionDepth: 0.25,
    uvMetersPerRepeat: 2.0,
    triangleBudget: 12,
    build: box,
  }),
  roof: module("roof", "roof", {
    constructionDepth: 0.2,
    uvMetersPerRepeat: 2.0,
    triangleBudget: 18,
    build: (context) => context.emitRoof({ variant: context.placement.moduleVariant }),
  }),
  finial: module("finial", "bronze", {
    constructionDepth: 0.35,
    uvMetersPerRepeat: 0.8,
    triangleBudget: 32,
    build: (context) => context.emitPrism({ radialSegments: context.qualityTier === "hero" ? 8 : 6 }),
  }),
});

export function validateModuleRegistry(plan, registry = MODULE_REGISTRY) {
  const used = new Set(plan.placements.map((placement) => placement.moduleId));
  const registered = new Set(Object.keys(registry));
  const missingModuleIds = Array.from(used).filter((id) => !registered.has(id));
  const unusedModuleIds = Array.from(registered).filter((id) => !used.has(id));
  const invalidBuilders = Array.from(registered).filter((id) => typeof registry[id].build !== "function");
  return {
    ok: missingModuleIds.length === 0 && invalidBuilders.length === 0,
    missingModuleIds,
    unusedModuleIds,
    invalidBuilders,
  };
}
