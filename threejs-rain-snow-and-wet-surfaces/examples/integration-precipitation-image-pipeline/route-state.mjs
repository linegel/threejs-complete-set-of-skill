export const INTEGRATION_SCENARIOS = Object.freeze([
  "shared-weather-primary-pass",
  "recurrent-weather-primary-pass",
]);
export const INTEGRATION_MECHANISMS = Object.freeze([
  "shared-signal-identity",
  "host-output-ownership",
  "single-scene-submission",
  "weather-compute-before-host-render",
]);
export const INTEGRATION_TIERS = Object.freeze(["high", "medium", "budgeted"]);
export const INTEGRATION_MODES = Object.freeze([
  "final",
  "weather-state",
  "particles",
  "wetness",
  "snow",
  "impacts",
  "owner-graph",
]);
export const INTEGRATION_CAMERAS = Object.freeze(["near", "design", "far"]);

const SCENARIO_MECHANISM = Object.freeze({
  "shared-weather-primary-pass": "weather-envelope-coupling",
  "recurrent-weather-primary-pass": "analytic-vs-recurrent",
});
const MECHANISM_RUNTIME = Object.freeze({
  "shared-signal-identity": Object.freeze({ mechanism: "weather-envelope-coupling", mode: "weather-state" }),
  "host-output-ownership": Object.freeze({ mechanism: "weather-envelope-coupling", mode: "owner-graph" }),
  "single-scene-submission": Object.freeze({ mechanism: "weather-envelope-coupling", mode: "final" }),
  "weather-compute-before-host-render": Object.freeze({ mechanism: "analytic-vs-recurrent", mode: "particles" }),
});

function requireChoice(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown precipitation integration ${label} "${value}"`);
  return value;
}

export function resolveIntegrationRoute(input) {
  const url = input instanceof URL ? input : new URL(input, "http://127.0.0.1");
  const scenario = requireChoice(url.searchParams.get("scenario") ?? INTEGRATION_SCENARIOS[0], INTEGRATION_SCENARIOS, "scenario");
  const rawMechanism = url.searchParams.get("mechanism");
  const mechanism = rawMechanism === null ? null : requireChoice(rawMechanism, INTEGRATION_MECHANISMS, "mechanism");
  const requiresRecurrentTier = mechanism === "weather-compute-before-host-render"
    || scenario === "recurrent-weather-primary-pass";
  const tier = requireChoice(url.searchParams.get("tier") ?? (requiresRecurrentTier ? "high" : "medium"), INTEGRATION_TIERS, "tier");
  const mechanismRuntime = mechanism ? MECHANISM_RUNTIME[mechanism] : null;
  const mode = requireChoice(
    url.searchParams.get("mode") ?? mechanismRuntime?.mode ?? "final",
    INTEGRATION_MODES,
    "mode",
  );
  const camera = requireChoice(url.searchParams.get("camera") ?? "design", INTEGRATION_CAMERAS, "camera");
  const seed = Number(url.searchParams.get("seed") ?? 1);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("precipitation integration seed must be u32");
  return Object.freeze({
    scenario,
    mechanism,
    runtimeMechanism: mechanismRuntime?.mechanism ?? SCENARIO_MECHANISM[scenario],
    tier,
    mode,
    camera,
    seed: seed >>> 0,
  });
}

export { requireChoice as requireIntegrationChoice, SCENARIO_MECHANISM, MECHANISM_RUNTIME };
