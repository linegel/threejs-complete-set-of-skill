export const HABITAT_SCENARIOS = Object.freeze(["habitat"]);

export const HABITAT_MECHANISMS = Object.freeze([
  "shared-world-wind",
  "contact-ripple-trampling",
  "immutable-spawn-storage",
  "subject-consistent-culling-shadow-outline",
  "owner-graph",
]);

export const HABITAT_MECHANISM_MODE = Object.freeze({
  "shared-world-wind": "final",
  "contact-ripple-trampling": "contact-events",
  "immutable-spawn-storage": "vegetation-trampling",
  "subject-consistent-culling-shadow-outline": "shadow-parity",
  "owner-graph": "owner-graph",
});

export const HABITAT_MECHANISM_LOCK = Object.freeze({
  "shared-world-wind": Object.freeze({ mode: "final", tier: "balanced" }),
  "contact-ripple-trampling": Object.freeze({ mode: "contact-events", tier: "balanced" }),
  "immutable-spawn-storage": Object.freeze({ mode: "vegetation-trampling", tier: "hero" }),
  "subject-consistent-culling-shadow-outline": Object.freeze({ mode: "shadow-parity", tier: "hero" }),
  "owner-graph": Object.freeze({ mode: "owner-graph", tier: "balanced" }),
});

export const HABITAT_MODES = Object.freeze([
  "final",
  "no-post",
  "contact-events",
  "water-ripples",
  "vegetation-trampling",
  "culling",
  "outline",
  "shadow-parity",
  "owner-graph",
]);

export const HABITAT_CAMERAS = Object.freeze(["subject", "habitat", "population"]);
export const HABITAT_TIERS = Object.freeze(["hero", "balanced", "budgeted"]);
export const HABITAT_SEEDS = Object.freeze([0x00000001, 0x9e3779b9]);

export const HABITAT_TIER_CONFIG = Object.freeze({
  hero: Object.freeze({
    creatureTier: "hero",
    creatureCapacity: 4,
    creaturePopulation: 4,
    vegetationTier: "high",
    waterTier: "ultra",
    weatherTier: "high",
    cameraTier: "full",
    shadowMapSize: 2048,
    sceneScale: 1,
    waterScale: 1,
    dprCap: 2,
  }),
  balanced: Object.freeze({
    creatureTier: "crowd",
    creatureCapacity: 12,
    creaturePopulation: 10,
    vegetationTier: "medium",
    waterTier: "high",
    weatherTier: "medium",
    cameraTier: "budgeted",
    shadowMapSize: 1024,
    sceneScale: 1,
    waterScale: 0.5,
    dprCap: 1.5,
  }),
  budgeted: Object.freeze({
    creatureTier: "background",
    creatureCapacity: 20,
    creaturePopulation: 16,
    vegetationTier: "low",
    waterTier: "medium",
    weatherTier: "budgeted",
    cameraTier: "minimum",
    shadowMapSize: 512,
    sceneScale: 0.85,
    waterScale: 0.375,
    dprCap: 1,
  }),
});

export function requireHabitatChoice(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown creature-habitat ${label} "${value}"`);
  return value;
}

function parseSeed(value) {
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`invalid creature-habitat seed "${value}"`);
  }
  return seed >>> 0;
}

export function resolveHabitatRoute(input) {
  const url = input instanceof URL ? input : new URL(input, "http://127.0.0.1");
  const segments = url.pathname.split("/").filter(Boolean);
  const tierIndex = segments.lastIndexOf("tier");
  const pathTier = tierIndex >= 0 ? segments[tierIndex + 1] : null;
  const mechanismIndex = segments.lastIndexOf("mechanism");
  const pathMechanism = mechanismIndex >= 0 ? segments[mechanismIndex + 1] : null;
  const queryTier = url.searchParams.get("tier");
  if (pathTier && queryTier && pathTier !== queryTier) {
    throw new Error(`locked tier route "${pathTier}" rejects query tier "${queryTier}"`);
  }

  const scenario = requireHabitatChoice(
    url.searchParams.get("scenario") ?? "habitat",
    HABITAT_SCENARIOS,
    "scenario",
  );
  const queryMechanism = url.searchParams.get("mechanism");
  if (pathMechanism && queryMechanism && pathMechanism !== queryMechanism) {
    throw new Error(`locked mechanism route "${pathMechanism}" rejects query mechanism "${queryMechanism}"`);
  }
  const mechanismValue = pathMechanism ?? queryMechanism;
  const mechanism = mechanismValue === null
    ? null
    : requireHabitatChoice(mechanismValue, HABITAT_MECHANISMS, "mechanism");
  const requestedMode = url.searchParams.get("mode");
  const mechanismLock = mechanism ? HABITAT_MECHANISM_LOCK[mechanism] : null;
  if (mechanismLock && requestedMode && requestedMode !== mechanismLock.mode) {
    throw new Error(`locked mechanism route "${mechanism}" rejects mode "${requestedMode}"`);
  }
  if (mechanismLock && (pathTier ?? queryTier) && (pathTier ?? queryTier) !== mechanismLock.tier) {
    throw new Error(`locked mechanism route "${mechanism}" rejects tier "${pathTier ?? queryTier}"`);
  }
  const mode = requireHabitatChoice(
    requestedMode ?? mechanismLock?.mode ?? (mechanism ? HABITAT_MECHANISM_MODE[mechanism] : "final"),
    HABITAT_MODES,
    "mode",
  );
  const camera = requireHabitatChoice(
    url.searchParams.get("camera") ?? "habitat",
    HABITAT_CAMERAS,
    "camera",
  );
  const tier = requireHabitatChoice(pathTier ?? queryTier ?? mechanismLock?.tier ?? "balanced", HABITAT_TIERS, "tier");
  const seed = parseSeed(url.searchParams.get("seed") ?? HABITAT_SEEDS[0]);

  return Object.freeze({
    scenario,
    mechanism,
    mode,
    camera,
    tier,
    seed,
    tierLocked: Boolean(pathTier || mechanismLock),
    modeLocked: Boolean(mechanismLock),
  });
}
