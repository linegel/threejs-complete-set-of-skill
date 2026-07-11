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
  return index < 0 ? null : pieces[index + 1] ?? null;
}

function exact(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown motion ${label}: ${value}`);
  return value;
}

export function parseMotionRoute(locationLike = globalThis.location) {
  const pathname = locationLike?.pathname ?? "/";
  const params = new URLSearchParams(locationLike?.search ?? "");
  const scenario = segment(pathname, "mechanism") ?? params.get("scenario") ?? "spin-docking";
  const tier = segment(pathname, "tier") ?? params.get("tier") ?? "full";
  const mode = params.get("mode") ?? "final";
  return Object.freeze({
    scenario: exact(scenario, MOTION_SCENARIOS, "scenario"),
    tier: exact(tier, Object.keys(MOTION_TIERS), "tier"),
    mode: exact(mode, MOTION_MODES, "mode"),
  });
}

export function assertMotionRouteLock(route, { scenario = route.scenario, tier = route.tier } = {}) {
  exact(scenario, MOTION_SCENARIOS, "scenario");
  exact(tier, Object.keys(MOTION_TIERS), "tier");
  if (scenario !== route.scenario) throw new Error(`motion mechanism route is locked to ${route.scenario}`);
  if (tier !== route.tier) throw new Error(`motion tier route is locked to ${route.tier}`);
  return route;
}
