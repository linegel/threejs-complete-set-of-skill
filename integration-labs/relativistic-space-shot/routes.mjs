export const RELATIVISTIC_SCENARIOS = Object.freeze(["shot"]);
export const RELATIVISTIC_MECHANISMS = Object.freeze([
  "curved-ray-hdr",
  "motion-event-packets",
  "gpu-particle-pools",
  "shared-emissive-bloom",
  "single-temporal-exposure-output",
  "owner-graph",
]);
export const RELATIVISTIC_TIERS = Object.freeze(["hero", "balanced", "budgeted"]);
export const RELATIVISTIC_MODES = Object.freeze([
  "final",
  "no-post",
  "curved-ray",
  "integration-pressure",
  "velocity",
  "particles",
  "emissive",
  "bloom",
  "exposure",
  "temporal-confidence",
  "owner-graph",
]);
export const RELATIVISTIC_CAMERAS = Object.freeze(["near", "design", "far"]);
export const RELATIVISTIC_SEEDS = Object.freeze([0x00000001, 0x9e3779b9]);

export const RELATIVISTIC_MECHANISM_MODES = Object.freeze({
  "curved-ray-hdr": "curved-ray",
  "motion-event-packets": "velocity",
  "gpu-particle-pools": "particles",
  "shared-emissive-bloom": "bloom",
  "single-temporal-exposure-output": "temporal-confidence",
  "owner-graph": "owner-graph",
});

function exact(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown Relativistic Space Shot ${label}: ${value}`);
  return value;
}

function segment(pathname, label) {
  const parts = String(pathname ?? "/").split("/").filter(Boolean);
  const index = parts.lastIndexOf(label);
  return index < 0 ? null : parts[index + 1] ?? null;
}

export function parseRelativisticRoute(locationLike = globalThis.location) {
  const pathname = locationLike?.pathname ?? "/";
  const params = new URLSearchParams(locationLike?.search ?? "");
  const mechanismValue = segment(pathname, "mechanism") ?? params.get("mechanism");
  const tierSegment = segment(pathname, "tier");
  const tierParam = params.get("tier");
  const tierValue = tierSegment ?? tierParam ?? "balanced";
  // Only lock the tier when the URL explicitly selects a tier route/query.
  // The primary browser entry stays free so capture can sweep hero/balanced/budgeted.
  const tierLocked = tierSegment !== null || tierParam !== null;
  const mechanism = mechanismValue === null
    ? null
    : exact(mechanismValue, RELATIVISTIC_MECHANISMS, "mechanism");
  const tier = exact(tierValue, RELATIVISTIC_TIERS, "tier");
  const requestedMode = params.get("mode") ?? "final";
  const mode = mechanism === null
    ? exact(requestedMode, RELATIVISTIC_MODES, "mode")
    : RELATIVISTIC_MECHANISM_MODES[mechanism];
  const scenario = exact(params.get("scenario") ?? "shot", RELATIVISTIC_SCENARIOS, "scenario");
  return Object.freeze({
    scenario,
    mechanism,
    tier,
    mode,
    tierLocked,
    modeLocked: mechanism !== null,
  });
}

export function assertRelativisticRouteLock(route, {
  scenario = route.scenario,
  tier = route.tier,
  mode = route.mode,
} = {}) {
  exact(scenario, RELATIVISTIC_SCENARIOS, "scenario");
  exact(tier, RELATIVISTIC_TIERS, "tier");
  exact(mode, RELATIVISTIC_MODES, "mode");
  if (scenario !== route.scenario) throw new Error(`Relativistic Space Shot scenario route is locked to ${route.scenario}`);
  if (route.tierLocked && tier !== route.tier) throw new Error(`Relativistic Space Shot tier route is locked to ${route.tier}`);
  if (route.modeLocked && mode !== route.mode) throw new Error(`Relativistic Space Shot mechanism mode is locked to ${route.mode}`);
  return route;
}
