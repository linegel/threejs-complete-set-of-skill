export const FINAL_IMAGE_FLIGHT_SCENARIOS = Object.freeze(["flight"]);
export const FINAL_IMAGE_FLIGHT_MECHANISMS = Object.freeze([
  "camera-motion-ownership",
  "ao-prepass-lit-pair",
  "shared-emissive-bloom",
  "exposure-output-order",
  "shadow-contribution",
  "owner-graph",
]);
export const FINAL_IMAGE_FLIGHT_TIERS = Object.freeze(["hero", "balanced", "budgeted"]);
export const FINAL_IMAGE_FLIGHT_MODES = Object.freeze([
  "final",
  "no-post",
  "velocity",
  "ao",
  "emissive",
  "bloom",
  "exposure",
  "shadow-contribution",
  "owner-graph",
]);
export const FINAL_IMAGE_FLIGHT_CAMERAS = Object.freeze(["near", "design", "far"]);
export const FINAL_IMAGE_FLIGHT_SEEDS = Object.freeze([0x00000001, 0x9e3779b9]);

const MECHANISM_MODE = Object.freeze({
  "camera-motion-ownership": "owner-graph",
  "ao-prepass-lit-pair": "ao",
  "shared-emissive-bloom": "bloom",
  "exposure-output-order": "exposure",
  "shadow-contribution": "shadow-contribution",
  "owner-graph": "owner-graph",
});

function exact(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown Final Image Flight ${label}: ${value}`);
  return value;
}

function segment(pathname, label) {
  const parts = String(pathname ?? "/").split("/").filter(Boolean);
  const index = parts.lastIndexOf(label);
  return index < 0 ? null : parts[index + 1] ?? null;
}

function lockedSelector({ pathname, params, kind, allowed, fallback = null }) {
  const pathnameParts = String(pathname ?? "/").split("/").filter(Boolean);
  const pathValue = segment(pathname, kind);
  if (pathnameParts.includes(kind) && pathValue === null) throw new Error(`missing Final Image Flight ${kind} route id`);
  if (params.getAll(kind).length > 1) throw new Error(`duplicate Final Image Flight ${kind} query lock`);
  const queryPresent = params.has(kind);
  const queryValue = queryPresent ? params.get(kind) : null;
  if (pathValue !== null && queryPresent && pathValue !== queryValue) {
    throw new Error(`conflicting Final Image Flight ${kind} locks: path=${pathValue}, query=${queryValue}`);
  }
  const selected = pathValue ?? queryValue ?? fallback;
  return Object.freeze({
    value: selected === null ? null : exact(selected, allowed, kind),
    locked: pathValue !== null || queryPresent,
    source: pathValue !== null ? (queryPresent ? "path+query" : "path") : (queryPresent ? "query" : "default"),
  });
}

export function parseFinalImageFlightRoute(locationLike = globalThis.location) {
  const pathname = locationLike?.pathname ?? "/";
  const params = new URLSearchParams(locationLike?.search ?? "");
  const scenarioSelection = lockedSelector({
    pathname,
    params,
    kind: "scenario",
    allowed: FINAL_IMAGE_FLIGHT_SCENARIOS,
    fallback: "flight",
  });
  const mechanismSelection = lockedSelector({
    pathname,
    params,
    kind: "mechanism",
    allowed: FINAL_IMAGE_FLIGHT_MECHANISMS,
  });
  const tierSelection = lockedSelector({
    pathname,
    params,
    kind: "tier",
    allowed: FINAL_IMAGE_FLIGHT_TIERS,
    fallback: "balanced",
  });
  if (params.getAll("mode").length > 1) throw new Error("duplicate Final Image Flight mode query lock");
  const mechanism = mechanismSelection.value;
  const requestedMode = exact(params.get("mode") ?? "final", FINAL_IMAGE_FLIGHT_MODES, "mode");
  const mechanismMode = mechanism === null ? null : MECHANISM_MODE[mechanism];
  if (mechanismMode !== null && params.has("mode") && requestedMode !== mechanismMode) {
    throw new Error(`conflicting Final Image Flight mechanism/mode locks: ${mechanism} requires ${mechanismMode}`);
  }
  const mode = mechanismMode ?? requestedMode;
  return Object.freeze({
    scenario: scenarioSelection.value,
    mechanism,
    tier: tierSelection.value,
    mode,
    scenarioLocked: scenarioSelection.locked,
    mechanismLocked: mechanismSelection.locked,
    tierLocked: tierSelection.locked,
    modeLocked: mechanismSelection.locked || params.has("mode"),
    lockSources: Object.freeze({
      scenario: scenarioSelection.source,
      mechanism: mechanismSelection.source,
      tier: tierSelection.source,
      mode: mechanismSelection.locked ? mechanismSelection.source : (params.has("mode") ? "query" : "default"),
    }),
  });
}

export function assertFinalImageFlightRouteLock(route, {
  scenario = route.scenario,
  tier = route.tier,
  mode = route.mode,
} = {}) {
  exact(scenario, FINAL_IMAGE_FLIGHT_SCENARIOS, "scenario");
  exact(tier, FINAL_IMAGE_FLIGHT_TIERS, "tier");
  exact(mode, FINAL_IMAGE_FLIGHT_MODES, "mode");
  if (scenario !== route.scenario) throw new Error(`Final Image Flight scenario route is locked to ${route.scenario}`);
  if (route.tierLocked && tier !== route.tier) throw new Error(`Final Image Flight tier route is locked to ${route.tier}`);
  if (route.modeLocked && mode !== route.mode) throw new Error(`Final Image Flight mechanism mode is locked to ${route.mode}`);
  return route;
}
