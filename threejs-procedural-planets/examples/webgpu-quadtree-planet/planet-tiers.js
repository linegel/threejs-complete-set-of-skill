export const PLANET_TIER_IDS = Object.freeze(["full", "balanced", "reduced-webgpu"]);

export const PLANET_TIER_CONFIG = Object.freeze({
  full: Object.freeze({
    gridSide: 33,
    minLevel: 1,
    maxLevel: 7,
    splitPixelError: 8,
    mergePixelError: 4.5,
    maximumSurfaceSlope: 4,
    dprCap: 2,
  }),
  balanced: Object.freeze({
    gridSide: 17,
    minLevel: 1,
    maxLevel: 6,
    splitPixelError: 9,
    mergePixelError: 5,
    maximumSurfaceSlope: 4,
    dprCap: 1.5,
  }),
  "reduced-webgpu": Object.freeze({
    gridSide: 17,
    minLevel: 0,
    maxLevel: 4,
    splitPixelError: 11,
    mergePixelError: 6,
    maximumSurfaceSlope: 4,
    dprCap: 1,
  }),
});

export function requirePlanetTier(id) {
  const tier = PLANET_TIER_CONFIG[id];
  if (!tier) throw new Error(`unknown planet tier "${id}"`);
  return tier;
}

export function assertPlanetDpr(id, dpr) {
  const tier = requirePlanetTier(id);
  if (!(dpr > 0) || !Number.isFinite(dpr)) {
    throw new Error("planet DPR must be finite and positive");
  }
  if (dpr > tier.dprCap) {
    throw new Error(`requested DPR ${dpr} exceeds locked ${id} cap ${tier.dprCap}`);
  }
  return dpr;
}
