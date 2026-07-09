import { DEFAULT_CLIPMAP_CONFIG } from "./clipmap-config.js";

export const SHADOW_MECHANISM_ROUTES = Object.freeze({
  "bounded-shadow": Object.freeze({
    architecture: "bounded",
    scenario: "bounded-baseline",
    mode: "final",
    actions: Object.freeze(["render-bounded-shadow"]),
  }),
  csm: Object.freeze({
    architecture: "csm",
    scenario: "depth-span",
    mode: "final",
    actions: Object.freeze(["render-csm-depth-span"]),
  }),
  "tiled-shadow": Object.freeze({
    architecture: "tiled",
    scenario: "fixed-footprint",
    mode: "final",
    actions: Object.freeze(["render-tiled-footprint"]),
  }),
  "cached-clipmap": Object.freeze({
    architecture: "cached",
    scenario: "persistent-coverage",
    mode: "final",
    actions: Object.freeze(["populate-cached-levels"]),
  }),
  "texel-snap-and-pan": Object.freeze({
    architecture: "cached",
    scenario: "slow-subtexel-pan",
    mode: "level-centers",
    actions: Object.freeze(["populate-cached-levels", "subtexel-camera-pan"]),
  }),
  "bias-sweep": Object.freeze({
    architecture: "cached",
    scenario: "bias-sweep",
    mode: "shadow-contribution",
    actions: Object.freeze(["populate-cached-levels", "sweep-bias-normal-bias"]),
  }),
  "targeted-invalidation": Object.freeze({
    architecture: "cached",
    scenario: "swept-caster-invalidation",
    mode: "level-validity",
    actions: Object.freeze(["populate-cached-levels", "move-caster-and-invalidate"]),
  }),
  "scheduler-fairness": Object.freeze({
    architecture: "cached",
    scenario: "age-priority-round-robin",
    mode: "scheduler",
    actions: Object.freeze(["populate-cached-levels", "force-refresh-and-drain-fairly"]),
  }),
  "caster-position-parity": Object.freeze({
    architecture: "cached",
    scenario: "alpha-displaced-instanced-morph",
    mode: "silhouette-parity",
    actions: Object.freeze(["populate-cached-levels", "animate-all-caster-classes"]),
  }),
});

export function validateMechanismActionContract(routes = SHADOW_MECHANISM_ROUTES) {
  const errors = [];
  const actionSignatures = new Set();
  for (const [id, route] of Object.entries(routes)) {
    if (!SHADOW_ARCHITECTURE_IDS.has(route?.architecture)) {
      errors.push(`${id}: unknown architecture ${route?.architecture}`);
    }
    if (typeof route?.scenario !== "string" || route.scenario.length === 0) {
      errors.push(`${id}: scenario must be a nonempty string`);
    }
    if (typeof route?.mode !== "string" || route.mode.length === 0) {
      errors.push(`${id}: mode must be a nonempty string`);
    }
    if (!Array.isArray(route?.actions) || route.actions.length === 0) {
      errors.push(`${id}: at least one executable action is required`);
      continue;
    }
    if (new Set(route.actions).size !== route.actions.length) {
      errors.push(`${id}: actions must be unique`);
    }
    const signature = route.actions.join("|");
    if (actionSignatures.has(signature)) {
      errors.push(`${id}: action sequence duplicates another mechanism route`);
    }
    actionSignatures.add(signature);
  }
  return { valid: errors.length === 0, errors };
}

const SHADOW_ARCHITECTURE_IDS = new Set(["bounded", "csm", "tiled", "cached"]);

export const SHADOW_QUALITY_TIERS = Object.freeze({
  ultra: Object.freeze({
    id: "ultra",
    targetClass: "current discrete/high-end adapter",
    frameTargetMs: 16.67,
    mapSizes: Object.freeze([2048, 2048, 1024, 1024, 512, 512, 512]),
    dynamicLevels: 2,
    updateBudget: 3,
    correctionBudget: 3,
    maxCacheAge: 48,
    nominalMemoryGateBytes: 128 * 1024 * 1024,
    performanceStatus: "INSUFFICIENT_EVIDENCE",
  }),
  high: Object.freeze({
    id: "high",
    targetClass: "current general-purpose adapter",
    frameTargetMs: 16.67,
    mapSizes: Object.freeze([1024, 1024, 1024, 512, 512, 512, 512]),
    dynamicLevels: 2,
    updateBudget: 2,
    correctionBudget: 2,
    maxCacheAge: 64,
    nominalMemoryGateBytes: 64 * 1024 * 1024,
    performanceStatus: "INSUFFICIENT_EVIDENCE",
  }),
  reduced: Object.freeze({
    id: "reduced",
    targetClass: "binding/memory constrained WebGPU adapter",
    frameTargetMs: 16.67,
    mapSizes: Object.freeze([512, 512, 512, 256, 256, 256, 256]),
    dynamicLevels: 1,
    updateBudget: 1,
    correctionBudget: 1,
    maxCacheAge: 96,
    nominalMemoryGateBytes: 32 * 1024 * 1024,
    performanceStatus: "INSUFFICIENT_EVIDENCE",
  }),
});

export function configForShadowTier(id) {
  const tier = SHADOW_QUALITY_TIERS[id];
  if (!tier) throw new RangeError(`unknown shadow tier: ${id}`);
  return {
    ...DEFAULT_CLIPMAP_CONFIG,
    mapSizes: [...tier.mapSizes],
    dynamicLevels: tier.dynamicLevels,
    updateBudget: tier.updateBudget,
    correctionBudget: tier.correctionBudget,
    maxCacheAge: tier.maxCacheAge,
    memoryBudgetBytes: tier.nominalMemoryGateBytes,
  };
}

export function mechanismIdForShadowScenario(scenario) {
  const matches = Object.entries(SHADOW_MECHANISM_ROUTES)
    .filter(([, route]) => route.scenario === scenario)
    .map(([id]) => id);
  if (matches.length !== 1) {
    throw new RangeError(
      matches.length === 0
        ? `unknown shadow scenario route: ${scenario}`
        : `ambiguous shadow scenario route: ${scenario}`,
    );
  }
  return matches[0];
}

export function resolveLockedShadowRoute(pathname) {
  const segments = String(pathname)
    .split("/")
    .filter(Boolean);
  const mechanismIndex = segments.lastIndexOf("mechanism");
  const tierIndex = segments.lastIndexOf("tier");

  if (mechanismIndex >= 0) {
    const mechanismId = segments[mechanismIndex + 1];
    const route = SHADOW_MECHANISM_ROUTES[mechanismId];
    if (!route) throw new RangeError(`unknown shadow mechanism route: ${mechanismId}`);
    return Object.freeze({
      kind: "mechanism-demo",
      mechanismId,
      tierId: "high",
      ...route,
    });
  }

  if (tierIndex >= 0) {
    const tierId = segments[tierIndex + 1];
    if (!SHADOW_QUALITY_TIERS[tierId]) {
      throw new RangeError(`unknown shadow tier route: ${tierId}`);
    }
    return Object.freeze({
      kind: "tier-demo",
      mechanismId: "cached-clipmap",
      tierId,
      ...SHADOW_MECHANISM_ROUTES["cached-clipmap"],
    });
  }

  return Object.freeze({
    kind: "canonical-lab",
    mechanismId: "cached-clipmap",
    tierId: "high",
    ...SHADOW_MECHANISM_ROUTES["cached-clipmap"],
  });
}
