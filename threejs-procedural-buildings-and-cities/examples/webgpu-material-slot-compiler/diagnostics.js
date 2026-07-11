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
  "tiers",
  "footprintPieces",
  "structuralClosures",
  "roofOwners",
];

function ownershipKey(placement, quantum) {
  const rect = placement.ownershipRect;
  const q = (value) => Math.round(value / quantum);
  return [
    rect.edgeId,
    rect.horizontal.map(q).join(":"),
    rect.vertical.map(q).join(":"),
    q(rect.normalDepth),
  ].join("|");
}

export function placementWorldBounds(placement) {
  const [x, y, z] = placement.position;
  const halfWidth = placement.dimensions.width * 0.5;
  const halfHeight = placement.dimensions.height * 0.5;
  const halfDepth = placement.dimensions.depth * 0.5;
  if (placement.side === "front" || placement.side === "back") {
    return {
      min: [x - halfWidth, y - halfHeight, z - halfDepth],
      max: [x + halfWidth, y + halfHeight, z + halfDepth],
    };
  }
  if (placement.side === "left" || placement.side === "right") {
    return {
      min: [x - halfDepth, y - halfHeight, z - halfWidth],
      max: [x + halfDepth, y + halfHeight, z + halfWidth],
    };
  }
  return {
    min: [x - halfWidth, y - halfHeight, z - halfDepth],
    max: [x + halfWidth, y + halfHeight, z + halfDepth],
  };
}

export function worldBoundsOverlap(a, b, tolerance = 0) {
  return [0, 1, 2].every((axis) =>
    Math.max(a.min[axis], b.min[axis]) < Math.min(a.max[axis], b.max[axis]) - tolerance);
}

export function createBuildingDiagnostics(plan) {
  const tolerance = plan.bayWidth * 1e-7;
  const ownershipQuantum = plan.bayWidth * 1e-6;
  const registry = validateModuleRegistry(plan);
  const moduleUsage = {};
  const materialSlotCounts = Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, 0]));
  const keyCounts = new Map();
  const ownershipRectangles = plan.placements.map((placement) => {
    moduleUsage[placement.moduleId] = (moduleUsage[placement.moduleId] ?? 0) + 1;
    materialSlotCounts[placement.slot] = (materialSlotCounts[placement.slot] ?? 0) + 1;
    const key = ownershipKey(placement, ownershipQuantum);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    return {
      id: placement.id,
      moduleId: placement.moduleId,
      side: placement.side,
      ...placement.ownershipRect,
      worldBounds: placementWorldBounds(placement),
    };
  });
  const overlapPairs = [];
  for (let a = 0; a < ownershipRectangles.length; a += 1) {
    for (let b = a + 1; b < ownershipRectangles.length; b += 1) {
      if (worldBoundsOverlap(
        ownershipRectangles[a].worldBounds,
        ownershipRectangles[b].worldBounds,
        tolerance,
      )) {
        overlapPairs.push([ownershipRectangles[a].id, ownershipRectangles[b].id]);
      }
    }
  }

  return {
    exposedIntervals: plan.exposedEdges.map((edge) => ({
      id: edge.id,
      start: edge.start,
      end: edge.end,
      blockerIntervals: edge.blockerIntervals,
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
    roofOwners: [...plan.roofOwners],
    tiers: plan.tiers.map((tier) => ({
      id: tier.id,
      role: tier.role,
      y0: tier.y0,
      height: tier.height,
      floors: tier.floors,
      pieceIds: [...tier.pieceIds],
    })),
    footprintPieces: plan.footprintPieces.map((piece) => ({ ...piece })),
    structuralClosures: plan.structuralClosures.map((closure) => ({ ...closure })),
    seed: plan.settings.seed,
    design: { ...plan.design },
    ownershipQuantum,
    overlapTolerance: tolerance,
  };
}

export function validateDiagnosticsSchema(diagnostics) {
  const missing = REQUIRED_DIAGNOSTIC_FIELDS.filter((field) => !(field in diagnostics));
  return { ok: missing.length === 0, missing };
}
