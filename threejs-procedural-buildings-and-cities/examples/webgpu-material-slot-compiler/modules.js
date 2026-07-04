export const MATERIAL_SLOTS = [
  "limestone",
  "granite",
  "terra-cotta",
  "glass",
  "bronze",
  "black-metal",
  "ornament",
  "roof",
];

function module(id, slot, {
  constructionDepth,
  uvMetersPerRepeat = 1.45,
  triangleBudget = 12,
  anchors = {},
} = {}) {
  return {
    id,
    slot,
    localFrame: "facade-x-right-y-up-z-out",
    constructionDepth,
    uvMetersPerRepeat,
    triangleBudget,
    anchors: {
      center: [0, 0, 0],
      ...anchors,
    },
    build(context) {
      return {
        moduleId: id,
        slot,
        localFrame: this.localFrame,
        constructionDepth,
        uvMetersPerRepeat,
        bounds: context.bounds,
      };
    },
  };
}

export const MODULE_REGISTRY = {
  plinth: module("plinth", "granite", { constructionDepth: 0.42, triangleBudget: 12 }),
  window: module("window", "glass", { constructionDepth: 0.18, uvMetersPerRepeat: 1.2, triangleBudget: 12 }),
  glassShaft: module("glassShaft", "glass", { constructionDepth: 0.22, uvMetersPerRepeat: 1.2, triangleBudget: 12 }),
  cornerPier: module("cornerPier", "limestone", { constructionDepth: 0.62, triangleBudget: 12 }),
  cornice: module("cornice", "ornament", { constructionDepth: 0.58, triangleBudget: 12 }),
  roof: module("roof", "roof", { constructionDepth: 0.2, uvMetersPerRepeat: 2.0, triangleBudget: 12 }),
  finial: module("finial", "bronze", { constructionDepth: 0.35, uvMetersPerRepeat: 0.8, triangleBudget: 24 }),
};

export function validateModuleRegistry(plan, registry = MODULE_REGISTRY) {
  const used = new Set(plan.placements.map((placement) => placement.moduleId));
  const registered = new Set(Object.keys(registry));
  const missingModuleIds = Array.from(used).filter((id) => !registered.has(id));
  const unusedModuleIds = Array.from(registered).filter((id) => !used.has(id));
  return {
    ok: missingModuleIds.length === 0,
    missingModuleIds,
    unusedModuleIds,
  };
}
