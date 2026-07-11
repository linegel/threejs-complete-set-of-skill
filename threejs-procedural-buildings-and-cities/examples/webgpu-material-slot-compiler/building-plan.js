import { computeExposedEdges, edgeContainsPlacement } from "./exposed-edges.js";
import { addRoofPlacements, createPlacements } from "./placements.js";
import { createBuildingDiagnostics } from "./diagnostics.js";

export const BAY_WIDTH = 3.2;
export const FLOOR_HEIGHT = 3.35;
export const PODIUM_FLOOR_HEIGHT = 4.45;

export const FIXTURE_SETTINGS = Object.freeze([
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
]);

function rect(id, x0, x1, z0, z1) {
  if (!(x1 > x0) || !(z1 > z0)) throw new Error(`invalid footprint rectangle ${id}`);
  return { id, x0, x1, z0, z1 };
}

function random01(seed, lane) {
  let value = (Number(seed) ^ Math.imul(lane + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

export function deriveDesign(settings) {
  const roofStyles = ["pyramidal-metal", "statue-tower", "flat-service"];
  const rhythms = ["chicago-grid", "paired-rhythm", "terra-cotta-arcade", "glass-spine"];
  return Object.freeze({
    roofStyle: roofStyles[Math.floor(random01(settings.seed, 0) * roofStyles.length) % roofStyles.length],
    shaftRhythm: settings.glassHeavy ? "glass-spine" : rhythms[Math.floor(random01(settings.seed, 1) * rhythms.length) % rhythms.length],
    towerScale: 0.72 + random01(settings.seed, 2) * 0.18,
    crownFloors: settings.qualityTier === "distant" ? 1 : 2,
    ornamentPhase: Math.floor(random01(settings.seed, 3) * 7),
    facadeVariant: Math.floor(random01(settings.seed, 4) * 16),
  });
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

function cloneForTier(piece, tierId, inset = 0) {
  const maxInset = Math.max(0, Math.min((piece.x1 - piece.x0 - 4 * BAY_WIDTH) / 2, (piece.z1 - piece.z0 - 4 * BAY_WIDTH) / 2));
  const resolvedInset = Math.max(0, Math.min(inset, maxInset));
  return rect(`${tierId}:${piece.id}`, piece.x0 + resolvedInset, piece.x1 - resolvedInset, piece.z0 + resolvedInset, piece.z1 - resolvedInset);
}

function tier(id, role, y0, height, floors, footprintPieces) {
  return { id, role, y0, height, floors, footprintPieces, pieceIds: footprintPieces.map((piece) => piece.id) };
}

export function createMassTiers(settings, basePieces, design = deriveDesign(settings)) {
  const floors = Math.max(8, settings.floors ?? 14);
  const podiumFloors = settings.podiumFloors ?? 2;
  const podiumHeight = podiumFloors * PODIUM_FLOOR_HEIGHT;
  const crownFloors = design.crownFloors;
  const shaftFloors = Math.max(4, floors - podiumFloors - crownFloors);
  const tiers = [];
  tiers.push(tier("podium", "podium", 0, podiumHeight, podiumFloors, basePieces.map((piece) => cloneForTier(piece, "podium"))));

  const twin = settings.footprint === "twin" || settings.footprint === "twin-bridge";
  const owners = twin ? basePieces : [rect(
    "shaft-union",
    Math.min(...basePieces.map((piece) => piece.x0)),
    Math.max(...basePieces.map((piece) => piece.x1)),
    Math.min(...basePieces.map((piece) => piece.z0)),
    Math.max(...basePieces.map((piece) => piece.z1)),
  )];
  for (const [index, owner] of owners.entries()) {
    const suffix = twin ? owner.id : "main";
    const shaftInset = (1 - design.towerScale) * BAY_WIDTH * (0.85 + 0.1 * index);
    const shaftPieces = [cloneForTier(owner, `${suffix}-shaft`, shaftInset)];
    const shaftY = podiumHeight;
    const shaftHeight = shaftFloors * FLOOR_HEIGHT;
    tiers.push(tier(`${suffix}-shaft`, "shaft", shaftY, shaftHeight, shaftFloors, shaftPieces));
    const crownPieces = shaftPieces.map((piece) => cloneForTier(piece, `${suffix}-crown`, BAY_WIDTH * 0.35));
    tiers.push(tier(`${suffix}-crown`, "crown", shaftY + shaftHeight, crownFloors * FLOOR_HEIGHT, crownFloors, crownPieces));
  }

  if (settings.footprint === "twin-bridge") {
    const west = basePieces[0];
    const east = basePieces[1];
    const bridgeDepth = Math.max(1.2 * BAY_WIDTH, (west.z1 - west.z0) * 0.18);
    const bridgePiece = rect("skybridge:bridge", west.x1, east.x0, -bridgeDepth / 2, bridgeDepth / 2);
    tiers.push(tier(
      "skybridge",
      "bridge",
      podiumHeight + FLOOR_HEIGHT * 5,
      FLOOR_HEIGHT * 1.15,
      1,
      [bridgePiece],
    ));
  }
  return tiers;
}

function flattenTierPieces(tiers) {
  return tiers.flatMap((entry) => entry.footprintPieces);
}

function structuralClosuresForTier(entry) {
  const closures = entry.footprintPieces.flatMap((piece) => [
    { id: `${entry.id}:${piece.id}:soffit`, tierId: entry.id, pieceId: piece.id, kind: "soffit", y: entry.y0 },
    { id: `${entry.id}:${piece.id}:deck`, tierId: entry.id, pieceId: piece.id, kind: "deck", y: entry.y0 + entry.height },
  ]);
  for (let a = 0; a < entry.footprintPieces.length; a += 1) {
    for (let b = a + 1; b < entry.footprintPieces.length; b += 1) {
      const first = entry.footprintPieces[a];
      const second = entry.footprintPieces[b];
      const xTouch = Math.abs(first.x1 - second.x0) < 1e-7 || Math.abs(second.x1 - first.x0) < 1e-7;
      const zTouch = Math.abs(first.z1 - second.z0) < 1e-7 || Math.abs(second.z1 - first.z0) < 1e-7;
      const zStart = Math.max(first.z0, second.z0);
      const zEnd = Math.min(first.z1, second.z1);
      const xStart = Math.max(first.x0, second.x0);
      const xEnd = Math.min(first.x1, second.x1);
      if (xTouch && zEnd > zStart) closures.push({ id: `${entry.id}:${first.id}:${second.id}:connector-x`, tierId: entry.id, pieceIds: [first.id, second.id], kind: "connector", axis: "x", interval: [zStart, zEnd] });
      if (zTouch && xEnd > xStart) closures.push({ id: `${entry.id}:${first.id}:${second.id}:connector-z`, tierId: entry.id, pieceIds: [first.id, second.id], kind: "connector", axis: "z", interval: [xStart, xEnd] });
    }
  }
  return closures;
}

export function createBuildingPlan(settings = FIXTURE_SETTINGS[0]) {
  const normalized = {
    name: "single tower",
    footprint: "single",
    seed: 11,
    widthBays: 9,
    depthBays: 7,
    floors: 14,
    podiumFloors: 2,
    ornamentDensity: 0.45,
    qualityTier: "hero",
    ...settings,
  };
  if (settings.widthBays == null && (normalized.footprint === "twin" || normalized.footprint === "twin-bridge")) {
    normalized.widthBays = 12;
  }
  const design = deriveDesign(normalized);
  const baseFootprintPieces = createFootprintPieces(normalized);
  const tiers = createMassTiers(normalized, baseFootprintPieces, design);
  const footprintPieces = flattenTierPieces(tiers);
  const exposedEdges = tiers.flatMap((entry) => computeExposedEdges(entry.footprintPieces, {
    tierId: entry.id,
    tolerance: BAY_WIDTH * 1e-7,
    minimumLength: BAY_WIDTH * 0.2,
  }));
  const plan = {
    schemaVersion: 2,
    settings: { ...normalized, design },
    design,
    bayWidth: BAY_WIDTH,
    floorHeight: FLOOR_HEIGHT,
    tiers,
    baseFootprintPieces,
    footprintPieces,
    exposedEdges,
    placements: [],
    structuralClosures: tiers.flatMap(structuralClosuresForTier),
    diagnostics: null,
  };
  plan.placements = createPlacements({ tiers, exposedEdges, settings: plan.settings });
  plan.roofOwners = addRoofPlacements(plan);
  plan.diagnostics = createBuildingDiagnostics(plan);
  return plan;
}

function rectanglesInteriorOverlap(a, b, epsilon = 1e-7) {
  return Math.max(a.x0, b.x0) < Math.min(a.x1, b.x1) - epsilon &&
    Math.max(a.z0, b.z0) < Math.min(a.z1, b.z1) - epsilon;
}

export function validateBuildingPlan(plan) {
  const errors = [];
  let diagnostics = null;
  if (!plan.footprintPieces.length) errors.push("empty footprintPieces");
  if (!plan.exposedEdges.length) errors.push("empty exposedEdges");
  if (!plan.placements.length) errors.push("empty placements");
  try {
    // Diagnostics are derived evidence. Never trust a snapshot attached when
    // the plan was first built: callers and mutation tests may have changed
    // placements, modules, or ownership after that snapshot was produced.
    diagnostics = createBuildingDiagnostics(plan);
  } catch (error) {
    errors.push(`diagnostic recomputation failed: ${error.message}`);
  }
  if (!diagnostics) errors.push("missing authoritative diagnostics");
  if (diagnostics?.missingModuleIds.length) errors.push("missing module builders");
  if (diagnostics?.duplicateKeys.length) errors.push("duplicate ownership keys");
  if (diagnostics?.overlapPairs.length) errors.push("overlap pairs");
  const placementIds = plan.placements.map((placement) => placement.id);
  if (new Set(placementIds).size !== placementIds.length) errors.push("duplicate placement ids");
  for (const entry of plan.tiers) {
    const bounds = {
      width: Math.max(...entry.footprintPieces.map((piece) => piece.x1)) - Math.min(...entry.footprintPieces.map((piece) => piece.x0)),
      depth: Math.max(...entry.footprintPieces.map((piece) => piece.z1)) - Math.min(...entry.footprintPieces.map((piece) => piece.z0)),
    };
    if (["shaft", "crown"].includes(entry.role) && (bounds.width < 4 * BAY_WIDTH - 1e-6 || bounds.depth < 4 * BAY_WIDTH - 1e-6)) {
      errors.push(`${entry.id} below four-bay span`);
    }
    for (let a = 0; a < entry.footprintPieces.length; a += 1) {
      for (let b = a + 1; b < entry.footprintPieces.length; b += 1) {
        if (rectanglesInteriorOverlap(entry.footprintPieces[a], entry.footprintPieces[b])) errors.push(`${entry.id} footprint interiors overlap`);
      }
    }
  }
  for (const placement of plan.placements.filter((entry) => entry.side !== "top")) {
    const edge = plan.exposedEdges.find((candidate) => candidate.id === placement.edgeId);
    if (!edge || !edgeContainsPlacement(edge, placement)) errors.push(`${placement.id} is outside exposed edge`);
  }
  return { ok: errors.length === 0, errors, diagnostics };
}

export function buildingPlanSignature(plan) {
  return JSON.stringify({
    design: plan.design,
    tiers: plan.tiers.map((entry) => [entry.role, entry.y0, entry.height, entry.footprintPieces.map((piece) => [piece.x0, piece.x1, piece.z0, piece.z1])]),
    placements: plan.placements.map((entry) => [entry.moduleId, entry.side, entry.interval.start, entry.interval.end]),
  });
}
