import { MODULE_REGISTRY } from "./modules.js";

function edgeWidth(edge, count, index) {
  const bayWidth = edge.length / count;
  const center = edge.start + bayWidth * (index + 0.5);
  return { bayWidth, center };
}

function placement({ tier, edge, moduleId, y0, height, start, end, role }) {
  const module = MODULE_REGISTRY[moduleId];
  return {
    id: `${tier.id}:${edge.id}:${moduleId}:${start.toFixed(2)}:${y0.toFixed(2)}`,
    tierId: tier.id,
    edgeId: edge.id,
    side: edge.side,
    role,
    moduleId,
    slot: module?.slot ?? "missing",
    interval: { start, end },
    ownershipRect: {
      edgeId: edge.id,
      horizontal: [start, end],
      vertical: [tier.y0 + y0, tier.y0 + y0 + height],
      normalDepth: module?.constructionDepth ?? 0,
    },
    localFrame: module?.localFrame ?? "missing",
    dimensions: {
      width: Math.max(0.2, end - start),
      height,
      depth: module?.constructionDepth ?? 0.2,
    },
    position: [edge.x, tier.y0 + y0 + height / 2, edge.z],
    uvMetersPerRepeat: module?.uvMetersPerRepeat ?? 1.45,
  };
}

export function createPlacements({ tiers, exposedEdges, settings }) {
  const placements = [];
  for (const tier of tiers) {
    if (tier.role === "bridge") continue;
    const tierEdges = exposedEdges.filter((edge) => tier.pieceIds.includes(edge.pieceId));
    for (const edge of tierEdges) {
      const bayCount = Math.max(edge.side === "front" || edge.side === "back" ? 5 : 3, Math.round(edge.length / 3.2));
      if (tier.role === "podium") {
        placements.push(
          placement({
            tier,
            edge,
            moduleId: "plinth",
            y0: 0,
            height: 0.74,
            start: edge.start,
            end: edge.end,
            role: tier.role,
          }),
        );
      } else {
        const pierWidth = Math.min(0.65, edge.length * 0.18);
        for (const [start, end] of [[edge.start, edge.start + pierWidth], [edge.end - pierWidth, edge.end]]) {
          placements.push(
            placement({
              tier,
              edge,
              moduleId: "cornerPier",
              y0: 0,
              height: Math.max(0.1, tier.height - 0.42),
              start,
              end,
              role: tier.role,
            }),
          );
        }
      }
      for (let bay = 0; bay < bayCount; bay += 1) {
        if (tier.role !== "podium" && (bay === 0 || bay === bayCount - 1)) continue;
        const { bayWidth, center } = edgeWidth(edge, bayCount, bay);
        const start = center - bayWidth * 0.34;
        const end = center + bayWidth * 0.34;
        const glassy = settings.glassHeavy || (edge.side === "front" && bay % 3 === 1);
        placements.push(
          placement({
            tier,
            edge,
            moduleId: glassy ? "glassShaft" : "window",
            y0: tier.role === "podium" ? 1.0 : 0.65,
            height: tier.role === "podium" ? Math.max(1.4, tier.height - 1.6) : Math.min(2.2, tier.height - 0.8),
            start,
            end,
            role: tier.role,
          }),
        );
      }
      placements.push(
        placement({
          tier,
          edge,
          moduleId: "cornice",
          y0: tier.height - 0.35,
          height: 0.35,
          start: edge.start,
          end: edge.end,
          role: tier.role,
        }),
      );
    }
  }
  return placements;
}

export function addRoofPlacements(plan) {
  const highest = Math.max(...plan.tiers.map((tier) => tier.y0 + tier.height));
  const owners = plan.tiers.filter((tier) => Math.abs(tier.y0 + tier.height - highest) <= 0.001);
  for (const owner of owners) {
    const piece = plan.footprintPieces.find((entry) => owner.pieceIds.includes(entry.id));
    const roofId = `${owner.id}:roof`;
    plan.placements.push({
      id: roofId,
      tierId: owner.id,
      edgeId: `${owner.id}:roof-owner`,
      side: "top",
      role: "roof",
      moduleId: "roof",
      slot: "roof",
      interval: { start: piece.x0, end: piece.x1 },
      ownershipRect: {
        edgeId: `${owner.id}:roof-owner`,
        horizontal: [piece.x0, piece.x1],
        vertical: [owner.y0 + owner.height, owner.y0 + owner.height + 1.2],
        normalDepth: 0.2,
      },
      roofOwnerId: owner.id,
      localFrame: "roof-x-right-y-up-z-forward",
      dimensions: { width: piece.x1 - piece.x0, height: 1.2, depth: piece.z1 - piece.z0 },
      position: [(piece.x0 + piece.x1) / 2, owner.y0 + owner.height + 0.6, (piece.z0 + piece.z1) / 2],
      uvMetersPerRepeat: 2.0,
    });
    plan.placements.push({
      id: `${roofId}:finial`,
      tierId: owner.id,
      edgeId: `${owner.id}:roof-owner`,
      side: "top",
      role: "roof",
      moduleId: "finial",
      slot: "bronze",
      interval: { start: piece.x0, end: piece.x1 },
      ownershipRect: {
        edgeId: `${owner.id}:roof-owner`,
        horizontal: [piece.x0, piece.x1],
        vertical: [owner.y0 + owner.height + 1.2, owner.y0 + owner.height + 3.2],
        normalDepth: 0.35,
      },
      roofOwnerId: owner.id,
      localFrame: "roof-x-right-y-up-z-forward",
      dimensions: { width: 0.8, height: 2.0, depth: 0.8 },
      position: [(piece.x0 + piece.x1) / 2, owner.y0 + owner.height + 2.2, (piece.z0 + piece.z1) / 2],
      uvMetersPerRepeat: 0.8,
    });
  }
  plan.diagnostics.roofOwners = owners.map((owner) => owner.id);
}
