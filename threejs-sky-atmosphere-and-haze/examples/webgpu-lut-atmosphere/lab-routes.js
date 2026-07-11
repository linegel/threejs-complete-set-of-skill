export const ATMOSPHERE_MECHANISM_MODES = Object.freeze({
  "transmittance-and-multiscatter": "multiscatter",
  "irradiance-and-sky-view": "sky-view",
  "aerial-perspective": "aerial-inscattering",
  "depth-and-ecef": "depth",
  "sun-moon-and-lighting": "irradiance",
  "sea-level-to-orbit": "final",
});

export const ATMOSPHERE_TIERS = Object.freeze(["ultra", "high", "mobile"]);
export const ATMOSPHERE_SCENARIOS = Object.freeze([
  "sea-level", "mountain", "low-orbit", "high-orbit", "night-side", "shell-entry",
]);
export const ATMOSPHERE_MODES = Object.freeze([
  "final", "no-post", "transmittance", "multiscatter", "irradiance",
  "sky-view", "aerial-inscattering", "aerial-optical-depth", "depth", "ecef",
]);

function pathRecord(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  for (const kind of ["mechanism", "tier", "scenario"]) {
    const index = parts.indexOf(kind);
    if (index >= 0) return { kind, id: parts[index + 1] ?? "" };
  }
  return { kind: "root", id: null };
}

export function resolveAtmosphereRoute({ pathname = "/", kind, id } = {}) {
  const route = kind ? { kind, id: id || null } : pathRecord(pathname);
  const state = { tier: "high", scenario: "sea-level", mode: "final" };
  if (route.kind === "root") return { state, lock: route };
  if (route.kind === "mechanism") {
    const mode = ATMOSPHERE_MECHANISM_MODES[route.id];
    if (!mode) throw new Error(`Unknown atmosphere mechanism route "${route.id}"`);
    state.mode = mode;
  } else if (route.kind === "tier") {
    if (!ATMOSPHERE_TIERS.includes(route.id)) throw new Error(`Unknown atmosphere tier route "${route.id}"`);
    state.tier = route.id;
  } else if (route.kind === "scenario") {
    if (!ATMOSPHERE_SCENARIOS.includes(route.id)) throw new Error(`Unknown atmosphere scenario route "${route.id}"`);
    state.scenario = route.id;
  } else {
    throw new Error(`Unknown atmosphere route kind "${route.kind}"`);
  }
  return { state, lock: route };
}

export function assertAtmosphereRouteTransition(lock, kind, id) {
  if (lock.kind === "mechanism" && kind === "mode") {
    const expected = ATMOSPHERE_MECHANISM_MODES[lock.id];
    if (id !== expected) throw new Error(`Mechanism route ${lock.id} locks mode ${expected}`);
  }
  if (lock.kind === "tier" && kind === "tier" && id !== lock.id) {
    throw new Error(`Tier route ${lock.id} is locked`);
  }
  if (lock.kind === "scenario" && kind === "scenario" && id !== lock.id) {
    throw new Error(`Scenario route ${lock.id} is locked`);
  }
}
