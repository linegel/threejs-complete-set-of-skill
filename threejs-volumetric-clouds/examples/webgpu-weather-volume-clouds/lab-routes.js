export const CLOUD_MECHANISM_MODES = Object.freeze({
  "flagship-transport": "final",
  "density-and-bounds": "ray-near-far",
  "cloud-shadows": "cloud-shadow",
  "temporal-and-upsample": "history-rejection",
  "tier-benchmark": "storage-budget",
  "atmosphere-composition": "final",
  "failure-diagnostics": "sample-counts",
});

export const CLOUD_TIERS = Object.freeze(["ultra", "high", "default", "mobile"]);
export const CLOUD_SCENARIOS = Object.freeze([
  "spherical-shell", "planar-slab", "obb-cloud-bank", "atmosphere-composition",
]);
export const CLOUD_MODES = Object.freeze([
  "final", "density", "ray-near-far", "sample-counts", "sun-optical-depth",
  "cloud-shadow", "transmittance", "representative-depth", "velocity",
  "history-uv", "variance-bounds", "history-rejection", "upsample-depth-weights", "storage-budget",
]);

function pathRecord(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  for (const kind of ["mechanism", "tier", "scenario"]) {
    const index = parts.indexOf(kind);
    if (index >= 0) return { kind, id: parts[index + 1] ?? "" };
  }
  return { kind: "root", id: null };
}

export function resolveCloudRoute({ pathname = "/", kind, id } = {}) {
  const route = kind ? { kind, id: id || null } : pathRecord(pathname);
  const state = { tier: "default", scenario: "spherical-shell", mode: "final" };
  if (route.kind === "root") return { state, lock: route };
  if (route.kind === "mechanism") {
    const mode = CLOUD_MECHANISM_MODES[route.id];
    if (!mode) throw new Error(`Unknown cloud mechanism route "${route.id}"`);
    state.mode = mode;
  } else if (route.kind === "tier") {
    if (!CLOUD_TIERS.includes(route.id)) throw new Error(`Unknown cloud tier route "${route.id}"`);
    state.tier = route.id;
  } else if (route.kind === "scenario") {
    if (!CLOUD_SCENARIOS.includes(route.id)) throw new Error(`Unknown cloud scenario route "${route.id}"`);
    state.scenario = route.id;
  } else {
    throw new Error(`Unknown cloud route kind "${route.kind}"`);
  }
  return { state, lock: route };
}

export function assertCloudRouteTransition(lock, kind, id) {
  if (lock.kind === "mechanism" && kind === "mode") {
    const expected = CLOUD_MECHANISM_MODES[lock.id];
    if (id !== expected) throw new Error(`Mechanism route ${lock.id} locks mode ${expected}`);
  }
  if (lock.kind === "tier" && kind === "tier" && id !== lock.id) {
    throw new Error(`Tier route ${lock.id} is locked`);
  }
  if (lock.kind === "scenario" && kind === "scenario" && id !== lock.id) {
    throw new Error(`Scenario route ${lock.id} is locked`);
  }
}
