import { FLOOR_HEIGHT } from "./building-plan.js";
import { MODULE_REGISTRY } from "./modules.js";

// Front/back façades own each orthogonal corner. Left/right modules that reach
// an endpoint are shortened by their matching module half-depth. Paired
// plinth/cornice/pier solids therefore meet exactly at the owner's inner face:
// no positive-volume overlap and no max-depth corner gap.
const ENDPOINT_EPSILON = 1e-7;

function quantizeBays(length, { target = 3.2, min = 2.35, max = 4.25, minimumCount = 1 } = {}) {
  const nMin = Math.max(minimumCount, Math.ceil(length / max));
  const nMax = Math.floor(length / min);
  if (nMin > nMax) return null;
  let best = nMin;
  let bestError = Infinity;
  for (let count = nMin; count <= nMax; count += 1) {
    const error = Math.abs(length / count - target);
    if (error < bestError) {
      best = count;
      bestError = error;
    }
  }
  return { count: best, width: length / best };
}

function placement({ tier, edge, moduleId, y0, height, start, end, role, variant = null }) {
  const module = MODULE_REGISTRY[moduleId];
  if (!module) throw new Error(`Unknown module ${moduleId}`);
  let ownedStart = start;
  let ownedEnd = end;
  if (edge.side === "left" || edge.side === "right") {
    const cornerTrim = module.constructionDepth * 0.5;
    if (Math.abs(start - edge.start) <= ENDPOINT_EPSILON) ownedStart += cornerTrim;
    if (Math.abs(end - edge.end) <= ENDPOINT_EPSILON) ownedEnd -= cornerTrim;
  }
  if (!(ownedEnd > ownedStart + ENDPOINT_EPSILON)) {
    throw new Error(`${moduleId} has no positive owned span after corner ownership trimming`);
  }
  const along = (ownedStart + ownedEnd) / 2;
  const position = edge.side === "front" || edge.side === "back"
    ? [along, tier.y0 + y0 + height / 2, edge.z]
    : [edge.x, tier.y0 + y0 + height / 2, along];
  return {
    id: `${tier.id}:${edge.id}:${moduleId}:${ownedStart.toFixed(4)}:${y0.toFixed(4)}:${variant ?? "base"}`,
    tierId: tier.id,
    edgeId: edge.id,
    side: edge.side,
    role,
    moduleId,
    moduleVariant: variant,
    slot: module.slot,
    interval: { start: ownedStart, end: ownedEnd },
    ownershipRect: {
      edgeId: edge.id,
      horizontal: [ownedStart, ownedEnd],
      vertical: [tier.y0 + y0, tier.y0 + y0 + height],
      normalDepth: module.constructionDepth,
      cornerRule: edge.side === "left" || edge.side === "right"
        ? "front-back-owns-orthogonal-corners"
        : "front-back-corner-owner",
    },
    localFrame: module.localFrame,
    dimensions: { width: ownedEnd - ownedStart, height, depth: module.constructionDepth },
    position,
    uvMetersPerRepeat: module.uvMetersPerRepeat,
  };
}

function addPodium(placements, tier, edge, settings, bays) {
  placements.push(placement({ tier, edge, moduleId: "plinth", y0: 0, height: 0.74, start: edge.start, end: edge.end, role: tier.role }));
  for (let bay = 0; bay < bays.count; bay += 1) {
    const center = edge.start + bays.width * (bay + 0.5);
    const start = center - bays.width * 0.34;
    const end = center + bays.width * 0.34;
    let moduleId = "window";
    if (edge.side === "front" && bay === Math.floor(bays.count / 2)) moduleId = "door";
    else if (edge.side === "back" && bay % 3 === 1) moduleId = "loadingDock";
    else if ((edge.side === "left" || edge.side === "right") && (bay === 0 || bay === bays.count - 1)) moduleId = "door";
    else if (settings.glassHeavy) moduleId = "glassShaft";
    placements.push(placement({
      tier,
      edge,
      moduleId,
      y0: 0.9,
      height: Math.max(1.6, tier.height - 1.55),
      start,
      end,
      role: tier.role,
      variant: `${settings.design.facadeVariant}:${bay}`,
    }));
  }
}

function addShaft(placements, tier, edge, settings, bays) {
  const pierWidth = Math.min(0.68, edge.length * 0.12);
  for (const [start, end] of [[edge.start, edge.start + pierWidth], [edge.end - pierWidth, edge.end]]) {
    placements.push(placement({ tier, edge, moduleId: "cornerPier", y0: 0, height: tier.height - 0.42, start, end, role: tier.role }));
  }
  const centerBay = Math.floor(bays.count / 2);
  const glassSpine = edge.side === "front" && settings.design.shaftRhythm === "glass-spine";
  if (glassSpine) {
    const center = edge.start + bays.width * (centerBay + 0.5);
    placements.push(placement({
      tier,
      edge,
      moduleId: "glassShaft",
      y0: 0.35,
      height: tier.height - 0.7,
      start: center - bays.width * 0.38,
      end: center + bays.width * 0.38,
      role: tier.role,
      variant: "reserved-whole-height-zone",
    }));
  }
  const floorStep = settings.qualityTier === "hero" ? 1 : settings.qualityTier === "city" ? 2 : 4;
  for (let floor = 0; floor < tier.floors; floor += floorStep) {
    for (let bay = 0; bay < bays.count; bay += 1) {
      if (bay === 0 || bay === bays.count - 1 || (glassSpine && bay === centerBay)) continue;
      const center = edge.start + bays.width * (bay + 0.5);
      const start = center - bays.width * 0.32;
      const end = center + bays.width * 0.32;
      let moduleId = settings.qualityTier === "distant" ? "facadePanel" : "window";
      if (settings.design.shaftRhythm === "terra-cotta-arcade" && floor % 2 === 0) moduleId = "archedWindow";
      const ornament = settings.qualityTier === "hero" && settings.ornamentDensity > 0.7 &&
        (floor + bay + settings.design.ornamentPhase) % 5 === 0;
      if (ornament) moduleId = "ornamentPanel";
      placements.push(placement({
        tier,
        edge,
        moduleId,
        y0: floor * FLOOR_HEIGHT + 0.55,
        height: Math.min(2.25, FLOOR_HEIGHT - 0.8),
        start,
        end,
        role: tier.role,
        variant: `${settings.design.shaftRhythm}:${floor}:${bay}`,
      }));
    }
  }
}

function addCrown(placements, tier, edge, settings, bays) {
  const pierWidth = Math.min(0.75, edge.length * 0.14);
  for (const [start, end] of [[edge.start, edge.start + pierWidth], [edge.end - pierWidth, edge.end]]) {
    placements.push(placement({ tier, edge, moduleId: "cornerPier", y0: 0, height: tier.height - 0.42, start, end, role: tier.role }));
  }
  for (let bay = 1; bay < bays.count - 1; bay += 1) {
    const center = edge.start + bays.width * (bay + 0.5);
    placements.push(placement({
      tier,
      edge,
      moduleId: settings.ornamentDensity > 0.55 ? "ornamentPanel" : "archedWindow",
      y0: 0.55,
      height: Math.max(1.2, tier.height - 1.25),
      start: center - bays.width * 0.33,
      end: center + bays.width * 0.33,
      role: tier.role,
      variant: `crown:${bay}`,
    }));
  }
  if (edge.side === "front" && settings.qualityTier === "hero") {
    const width = Math.min(edge.length * 0.34, bays.width * 2.2);
    placements.push(placement({ tier, edge, moduleId: "pediment", y0: tier.height - 0.7, height: 0.35, start: edge.center - width / 2, end: edge.center + width / 2, role: tier.role }));
  }
}

function addBridge(placements, tier, edge, settings, bays) {
  for (let bay = 0; bay < bays.count; bay += 1) {
    const center = edge.start + bays.width * (bay + 0.5);
    placements.push(placement({
      tier,
      edge,
      moduleId: edge.side === "front" || edge.side === "back" ? "glassShaft" : "facadePanel",
      y0: 0.28,
      height: tier.height - 0.63,
      start: center - bays.width * 0.4,
      end: center + bays.width * 0.4,
      role: tier.role,
      variant: `bridge:${settings.design.facadeVariant}:${bay}`,
    }));
  }
}

export function createPlacements({ tiers, exposedEdges, settings }) {
  const placements = [];
  for (const tier of tiers) {
    const tierEdges = exposedEdges.filter((edge) => edge.tierId === tier.id);
    for (const edge of tierEdges) {
      const minimumCount = tier.role === "podium"
        ? (edge.side === "front" || edge.side === "back" ? 5 : 3)
        : tier.role === "bridge" ? 2 : 4;
      const bays = quantizeBays(edge.length, { minimumCount });
      if (!bays) {
        placements.push(placement({ tier, edge, moduleId: "facadePanel", y0: 0, height: Math.max(0.2, tier.height - 0.35), start: edge.start, end: edge.end, role: tier.role, variant: "semantic-infill" }));
        placements.push(placement({ tier, edge, moduleId: "cornice", y0: tier.height - 0.35, height: 0.35, start: edge.start, end: edge.end, role: tier.role, variant: "semantic-infill-cornice" }));
        continue;
      }
      if (tier.role === "podium") addPodium(placements, tier, edge, settings, bays);
      else if (tier.role === "shaft") addShaft(placements, tier, edge, settings, bays);
      else if (tier.role === "crown") addCrown(placements, tier, edge, settings, bays);
      else addBridge(placements, tier, edge, settings, bays);
      placements.push(placement({ tier, edge, moduleId: "cornice", y0: tier.height - 0.35, height: 0.35, start: edge.start, end: edge.end, role: tier.role }));
    }
  }
  return placements;
}

export function addRoofPlacements(plan) {
  const roofCandidates = plan.tiers.filter((tier) => tier.role === "crown" || tier.role === "shaft");
  const highest = Math.max(...roofCandidates.map((tier) => tier.y0 + tier.height));
  const owners = roofCandidates.filter((tier) => Math.abs(tier.y0 + tier.height - highest) <= 1e-7);
  for (const owner of owners) {
    for (const piece of owner.footprintPieces) {
      const roofId = `${owner.id}:${piece.id}:roof`;
      plan.placements.push({
        id: roofId,
        tierId: owner.id,
        edgeId: `${owner.id}:${piece.id}:roof-owner`,
        side: "top",
        role: "roof",
        moduleId: "roof",
        moduleVariant: plan.design.roofStyle,
        slot: "roof",
        interval: { start: piece.x0, end: piece.x1 },
        ownershipRect: {
          edgeId: `${owner.id}:${piece.id}:roof-owner`,
          horizontal: [piece.x0, piece.x1],
          vertical: [owner.y0 + owner.height, owner.y0 + owner.height + 2.0],
          normalDepth: MODULE_REGISTRY.roof.constructionDepth,
        },
        roofOwnerId: owner.id,
        localFrame: "roof-x-right-y-up-z-forward",
        dimensions: { width: piece.x1 - piece.x0, height: 2.0, depth: piece.z1 - piece.z0 },
        position: [(piece.x0 + piece.x1) / 2, owner.y0 + owner.height + 1.0, (piece.z0 + piece.z1) / 2],
        uvMetersPerRepeat: 2.0,
      });
      if (plan.design.roofStyle !== "flat-service") {
        plan.placements.push({
          id: `${roofId}:finial`,
          tierId: owner.id,
          edgeId: `${owner.id}:${piece.id}:finial-owner`,
          side: "top",
          role: "roof",
          moduleId: "finial",
          moduleVariant: plan.design.roofStyle,
          slot: "bronze",
          interval: { start: -0.4, end: 0.4 },
          ownershipRect: {
            edgeId: `${owner.id}:${piece.id}:finial-owner`,
            horizontal: [-0.4, 0.4],
            vertical: [owner.y0 + owner.height + 2.0, owner.y0 + owner.height + 4.0],
            normalDepth: MODULE_REGISTRY.finial.constructionDepth,
          },
          roofOwnerId: owner.id,
          localFrame: "roof-x-right-y-up-z-forward",
          dimensions: { width: 0.8, height: 2.0, depth: 0.8 },
          position: [(piece.x0 + piece.x1) / 2, owner.y0 + owner.height + 3.0, (piece.z0 + piece.z1) / 2],
          uvMetersPerRepeat: 0.8,
        });
      }
    }
  }
  return owners.map((owner) => owner.id);
}
