import { MOTION_SCENARIOS } from "./timeline.js";

export const MOTION_TIERS = Object.freeze({
  full: Object.freeze({ instanceCount: 4096, dprCap: 2 }),
  balanced: Object.freeze({ instanceCount: 2048, dprCap: 1.5 }),
  "test-minimum": Object.freeze({ instanceCount: 64, dprCap: 1 }),
});

export const MOTION_MODES = Object.freeze(["final", "velocity", "emissive", "normal"]);

function segment(pathname, label) {
  const pieces = pathname.split("/").filter(Boolean);
  const index = pieces.lastIndexOf(label);
  if (index < 0) return null;
  const value = pieces[index + 1] ?? null;
  if (value === null) throw new RangeError(`motion ${label} route is missing its locked id`);
  return value;
}

function exact(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown motion ${label}: ${value}`);
  return value;
}

function oneQueryValue(params, key) {
  const values = params.getAll(key);
  if (values.length > 1) throw new RangeError(`duplicate motion ${key} query values are not allowed`);
  return values[0] ?? null;
}

export function parseMotionRoute(locationLike = globalThis.location) {
  const pathname = locationLike?.pathname ?? "/";
  const params = new URLSearchParams(locationLike?.search ?? "");
  const pathScenario = segment(pathname, "mechanism");
  const queryScenario = oneQueryValue(params, "scenario");
  const pathTier = segment(pathname, "tier");
  const queryTier = oneQueryValue(params, "tier");
  if (pathScenario !== null && queryScenario !== null && pathScenario !== queryScenario) {
    throw new Error(`motion mechanism route is locked to ${pathScenario}`);
  }
  if (pathTier !== null && queryTier !== null && pathTier !== queryTier) {
    throw new Error(`motion tier route is locked to ${pathTier}`);
  }
  const scenario = pathScenario ?? queryScenario ?? "spin-docking";
  const tier = pathTier ?? queryTier ?? "full";
  const mode = oneQueryValue(params, "mode") ?? "final";
  return Object.freeze({
    scenario: exact(scenario, MOTION_SCENARIOS, "scenario"),
    tier: exact(tier, Object.keys(MOTION_TIERS), "tier"),
    mode: exact(mode, MOTION_MODES, "mode"),
    locks: Object.freeze({
      scenario: pathScenario !== null,
      tier: pathTier !== null,
    }),
  });
}

export function assertMotionRouteLock(route, { scenario = route.scenario, tier = route.tier } = {}) {
  exact(scenario, MOTION_SCENARIOS, "scenario");
  exact(tier, Object.keys(MOTION_TIERS), "tier");
  if (route.locks?.scenario === true && scenario !== route.scenario) {
    throw new Error(`motion mechanism route is locked to ${route.scenario}`);
  }
  if (route.locks?.tier === true && tier !== route.tier) {
    throw new Error(`motion tier route is locked to ${route.tier}`);
  }
  return route;
}
