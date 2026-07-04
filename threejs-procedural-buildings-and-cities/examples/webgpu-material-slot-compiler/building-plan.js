import { computeExposedEdges } from "./exposed-edges.js";
import { addRoofPlacements, createPlacements } from "./placements.js";
import { createBuildingDiagnostics } from "./diagnostics.js";

export const BAY_WIDTH = 3.2;
export const FLOOR_HEIGHT = 3.35;
export const PODIUM_FLOOR_HEIGHT = 4.45;

export const FIXTURE_SETTINGS = [
  { name: "single tower", footprint: "single", seed: 11 },
  { name: "compound L", footprint: "L", seed: 12 },
  { name: "compound T", footprint: "T", seed: 13 },
  { name: "compound U", footprint: "U", seed: 14 },
  { name: "courtyard / free court", footprint: "courtyard", seed: 15 },
  { name: "twin towers", footprint: "twin", seed: 16 },
  { name: "twin towers with bridge", footprint: "twin-bridge", seed: 17 },
  { name: "high ornament density", footprint: "single", seed: 18, ornamentDensity: 0.95 },
  { name: "minimum-span upper tiers", footprint: "single", seed: 19, widthBays: 5, depthBays: 5 },
  { name: "glass-heavy facade", footprint: "single", seed: 20, glassHeavy: true },
  { name: "distant skyline chunk", footprint: "skyline", seed: 21, qualityTier: "distant" },
];

function rect(id, x0, x1, z0, z1) {
  return { id, x0, x1, z0, z1 };
}

export function createFootprintPieces(settings) {
  const width = (settings.widthBays ?? 9) * BAY_WIDTH;
  const depth = (settings.depthBays ?? 7) * BAY_WIDTH;
  const hw = width / 2;
  const hd = depth / 2;
  if (settings.footprint === "L") {
    return [rect("front-bar", -hw, hw, -hd, hd * 0.12), rect("rear-wing", -hw, -hw * 0.12, hd * 0.12, hd)];
  }
  if (settings.footprint === "T") {
    return [rect("cross-bar", -hw, hw, -hd, -hd * 0.2), rect("stem", -hw * 0.32, hw * 0.32, -hd * 0.2, hd)];
  }
  if (settings.footprint === "U" || settings.footprint === "courtyard") {
    return [
      rect("front-bar", -hw, hw, -hd, -hd * 0.35),
      rect("left-wing", -hw, -hw * 0.42, -hd * 0.35, hd),
      rect("right-wing", hw * 0.42, hw, -hd * 0.35, hd),
    ];
  }
  if (settings.footprint === "twin" || settings.footprint === "twin-bridge") {
    return [rect("tower-west", -hw, -hw * 0.18, -hd * 0.82, hd * 0.82), rect("tower-east", hw * 0.18, hw, -hd * 0.82, hd * 0.82)];
  }
  return [rect("main", -hw, hw, -hd, hd)];
}

export function createMassTiers(settings, footprintPieces) {
  const floors = settings.floors ?? 14;
  const podiumHeight = (settings.podiumFloors ?? 2) * PODIUM_FLOOR_HEIGHT;
  const tiers = [];
  tiers.push({
    id: "podium",
    role: "podium",
    y0: 0,
    height: podiumHeight,
    floors: settings.podiumFloors ?? 2,
    pieceIds: footprintPieces.map((piece) => piece.id),
  });
  if (settings.footprint === "twin" || settings.footprint === "twin-bridge") {
    for (const piece of footprintPieces) {
      tiers.push({
        id: `${piece.id}-shaft`,
        role: "shaft",
        y0: podiumHeight,
        height: Math.max(4, floors - 2) * FLOOR_HEIGHT,
        floors: floors - 2,
        pieceIds: [piece.id],
      });
    }
    if (settings.footprint === "twin-bridge") {
      tiers.push({
        id: "skybridge",
        role: "bridge",
        y0: podiumHeight + FLOOR_HEIGHT * 5,
        height: FLOOR_HEIGHT * 1.15,
        floors: 1,
        pieceIds: footprintPieces.map((piece) => piece.id),
      });
    }
  } else {
    tiers.push({
      id: "shaft",
      role: "shaft",
      y0: podiumHeight,
      height: Math.max(4, floors - 2) * FLOOR_HEIGHT,
      floors: floors - 2,
      pieceIds: footprintPieces.map((piece) => piece.id),
    });
  }
  return tiers;
}

export function createBuildingPlan(settings = FIXTURE_SETTINGS[0]) {
  const normalized = {
    widthBays: 9,
    depthBays: 7,
    floors: 14,
    podiumFloors: 2,
    ornamentDensity: 0.45,
    qualityTier: "hero",
    ...settings,
  };
  const footprintPieces = createFootprintPieces(normalized);
  const tiers = createMassTiers(normalized, footprintPieces);
  const exposedEdges = computeExposedEdges(footprintPieces);
  const plan = {
    settings: normalized,
    bayWidth: BAY_WIDTH,
    floorHeight: FLOOR_HEIGHT,
    tiers,
    footprintPieces,
    exposedEdges,
    placements: [],
    diagnostics: null,
  };
  plan.placements = createPlacements({ tiers, exposedEdges, settings: normalized });
  plan.diagnostics = createBuildingDiagnostics(plan);
  addRoofPlacements(plan);
  return plan;
}

export function validateBuildingPlan(plan) {
  const errors = [];
  if (!plan.footprintPieces.length) errors.push("empty footprintPieces");
  if (!plan.exposedEdges.length) errors.push("empty exposedEdges");
  if (!plan.placements.length) errors.push("empty placements");
  if (!plan.diagnostics) errors.push("missing diagnostics");
  if (plan.diagnostics.missingModuleIds.length) errors.push("missing module builders");
  if (plan.diagnostics.duplicateKeys.length) errors.push("duplicate ownership keys");
  if (plan.diagnostics.overlapPairs.length) errors.push("overlap pairs");
  return { ok: errors.length === 0, errors, diagnostics: plan.diagnostics };
}
