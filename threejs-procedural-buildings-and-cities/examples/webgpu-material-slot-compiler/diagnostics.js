import { MATERIAL_SLOTS, validateModuleRegistry } from "./modules.js";

export const REQUIRED_DIAGNOSTIC_FIELDS = [
  "exposedIntervals",
  "endpointFlags",
  "ownershipRectangles",
  "duplicateKeys",
  "overlapPairs",
  "moduleUsage",
  "missingModuleIds",
  "unusedModuleIds",
  "materialSlotCounts",
  "triangles",
  "drawCalls",
  "uvMetersPerRepeat",
  "bounds",
  "cullingState",
];

function ownershipKey(placement) {
  const rect = placement.ownershipRect;
  return [
    rect.edgeId,
    rect.horizontal.map((value) => value.toFixed(2)).join(":"),
    rect.vertical.map((value) => value.toFixed(2)).join(":"),
    rect.normalDepth.toFixed(2),
  ].join("|");
}

function overlaps(a, b) {
  if (a.edgeId !== b.edgeId) return false;
  const h = Math.max(a.horizontal[0], b.horizontal[0]) < Math.min(a.horizontal[1], b.horizontal[1]) - 0.001;
  const v = Math.max(a.vertical[0], b.vertical[0]) < Math.min(a.vertical[1], b.vertical[1]) - 0.001;
  return h && v;
}

export function createBuildingDiagnostics(plan) {
  const registry = validateModuleRegistry(plan);
  const moduleUsage = {};
  const materialSlotCounts = Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, 0]));
  const keyCounts = new Map();
  const ownershipRectangles = plan.placements.map((placement) => {
    moduleUsage[placement.moduleId] = (moduleUsage[placement.moduleId] ?? 0) + 1;
    materialSlotCounts[placement.slot] = (materialSlotCounts[placement.slot] ?? 0) + 1;
    const key = ownershipKey(placement);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    return { id: placement.id, ...placement.ownershipRect };
  });
  const overlapPairs = [];
  for (let a = 0; a < ownershipRectangles.length; a += 1) {
    for (let b = a + 1; b < ownershipRectangles.length; b += 1) {
      if (overlaps(ownershipRectangles[a], ownershipRectangles[b])) {
        overlapPairs.push([ownershipRectangles[a].id, ownershipRectangles[b].id]);
      }
    }
  }

  return {
    exposedIntervals: plan.exposedEdges.map((edge) => ({
      id: edge.id,
      start: edge.start,
      end: edge.end,
      blockerIntervals: [],
    })),
    endpointFlags: plan.exposedEdges.map((edge) => ({
      id: edge.id,
      isOuterCornerStart: edge.isOuterCornerStart,
      isOuterCornerEnd: edge.isOuterCornerEnd,
      isInnerCornerStart: edge.isInnerCornerStart,
      isInnerCornerEnd: edge.isInnerCornerEnd,
    })),
    ownershipRectangles,
    duplicateKeys: Array.from(keyCounts.entries()).filter(([, count]) => count > 1).map(([key]) => key),
    overlapPairs,
    moduleUsage,
    missingModuleIds: registry.missingModuleIds,
    unusedModuleIds: registry.unusedModuleIds,
    materialSlotCounts,
    triangles: {},
    drawCalls: 0,
    uvMetersPerRepeat: plan.placements.map((placement) => ({
      id: placement.id,
      value: placement.uvMetersPerRepeat,
    })),
    bounds: null,
    cullingState: "bounds-pending",
    roofOwners: [],
  };
}

export function validateDiagnosticsSchema(diagnostics) {
  const missing = REQUIRED_DIAGNOSTIC_FIELDS.filter((field) => !(field in diagnostics));
  return { ok: missing.length === 0, missing };
}
