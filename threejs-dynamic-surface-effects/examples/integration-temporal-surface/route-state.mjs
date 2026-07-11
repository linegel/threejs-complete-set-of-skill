export const TEMPORAL_SCENARIOS = Object.freeze([
  "host-scene-linear-frost",
  "host-temporal-reset-coupling",
]);
export const TEMPORAL_MECHANISMS = Object.freeze([
  "shared-scene-color",
  "shared-depth-velocity-camera",
  "feature-local-history",
  "host-reset-registry",
  "host-output-ownership",
]);
export const TEMPORAL_TIERS = Object.freeze(["full", "balanced", "budgeted"]);
export const TEMPORAL_MODES = Object.freeze([
  "final",
  "host-scene-color",
  "surface-history",
  "frost-mask",
  "refraction",
  "host-velocity",
  "reset-reason",
  "owner-graph",
]);
export const TEMPORAL_CAMERAS = Object.freeze(["near", "design", "far"]);

export const TEMPORAL_MECHANISM_MODE = Object.freeze({
  "shared-scene-color": "host-scene-color",
  "shared-depth-velocity-camera": "host-velocity",
  "feature-local-history": "surface-history",
  "host-reset-registry": "reset-reason",
  "host-output-ownership": "owner-graph",
});

function requireChoice(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown temporal-surface integration ${label} "${value}"`);
  return value;
}

export function resolveTemporalIntegrationRoute(input) {
  const url = input instanceof URL ? input : new URL(input, "http://127.0.0.1");
  const scenario = requireChoice(url.searchParams.get("scenario") ?? TEMPORAL_SCENARIOS[0], TEMPORAL_SCENARIOS, "scenario");
  const rawMechanism = url.searchParams.get("mechanism");
  const mechanism = rawMechanism === null ? null : requireChoice(rawMechanism, TEMPORAL_MECHANISMS, "mechanism");
  const tier = requireChoice(url.searchParams.get("tier") ?? "balanced", TEMPORAL_TIERS, "tier");
  const mode = requireChoice(
    url.searchParams.get("mode") ?? (mechanism ? TEMPORAL_MECHANISM_MODE[mechanism] : scenario === TEMPORAL_SCENARIOS[1] ? "reset-reason" : "final"),
    TEMPORAL_MODES,
    "mode",
  );
  const camera = requireChoice(url.searchParams.get("camera") ?? "design", TEMPORAL_CAMERAS, "camera");
  const seed = Number(url.searchParams.get("seed") ?? 1);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("temporal-surface seed must be u32");
  return Object.freeze({ scenario, mechanism, tier, mode, camera, seed: seed >>> 0 });
}

export { requireChoice as requireTemporalChoice };

