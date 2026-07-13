import assert from "node:assert/strict";

import {
  FROST_LAB_MODES,
  FROST_SCENARIO_ID,
  WebGPUFrostLab,
  parseFrostLabRoute,
} from "./frost-webgpu-lab.js";
import { FROST_MECHANISMS, FROST_QUALITY_TIERS } from "./frost-surface-effect.js";

const canonical = parseFrostLabRoute("/demos/webgpu-touch-history-frost/");
assert.deepEqual(canonical, {
  scenario: FROST_SCENARIO_ID,
  mechanism: "refraction-and-fresnel",
  tier: "balanced",
  mode: "final",
  routeKind: "canonical",
  locks: { scenario: true, mechanism: false, tier: false },
});

for (const mechanism of FROST_MECHANISMS) {
  const route = parseFrostLabRoute(`/demos/webgpu-touch-history-frost/mechanism/${mechanism}/`);
  assert.equal(route.mechanism, mechanism);
  assert.equal(route.tier, "balanced");
  assert.equal(route.mode, "final");
  assert.deepEqual(route.locks, { scenario: true, mechanism: true, tier: false });
  assert.deepEqual(
    parseFrostLabRoute(`/mechanism/${mechanism}/index.html`),
    route,
    "immutable static-build URLs must resolve to the same locked startup state",
  );
}

for (const tier of Object.keys(FROST_QUALITY_TIERS)) {
  const route = parseFrostLabRoute(`/demos/webgpu-touch-history-frost/tier/${tier}/`);
  assert.equal(route.mechanism, "refraction-and-fresnel");
  assert.equal(route.tier, tier);
  assert.equal(route.mode, "final");
  assert.deepEqual(route.locks, { scenario: true, mechanism: false, tier: true });
  assert.deepEqual(parseFrostLabRoute(`/tier/${tier}/index.html`), route);
}

assert.throws(
  () => parseFrostLabRoute("/demos/webgpu-touch-history-frost/mechanism/diffusion/extra/"),
  /unexpected path segments/,
);
assert.throws(
  () => parseFrostLabRoute("/demos/webgpu-touch-history-frost/mechanism/diffusion/tier/full/"),
  /cannot lock mechanism and tier simultaneously/,
);
assert.throws(
  () => parseFrostLabRoute("/demos/webgpu-touch-history-frost/", "?tier=full"),
  /selected by the route path/,
);
assert.throws(
  () => parseFrostLabRoute("/demos/webgpu-touch-history-frost/", "?mechanism=diffusion"),
  /selected by the route path/,
);

const mechanismLocked = new WebGPUFrostLab({
  mechanism: "diffusion",
  tier: "balanced",
  routeLocks: { scenario: true, mechanism: true },
});
mechanismLocked.effect = {
  debugView: "final",
  setMechanism: () => ({ startupDebugView: "final" }),
  setTier() {},
};
await mechanismLocked.setMechanism("diffusion");
await assert.rejects(mechanismLocked.setMechanism("history-and-deposit"), /locked to "diffusion"/);
await mechanismLocked.setTier("full");
assert.equal(mechanismLocked.tier.id, "full", "mechanism routes must leave tier selection mutable");

const tierLocked = new WebGPUFrostLab({
  mechanism: "refraction-and-fresnel",
  tier: "budgeted",
  routeLocks: { scenario: true, tier: true },
});
tierLocked.effect = {
  debugView: "final",
  setMechanism: () => ({ startupDebugView: "final" }),
  setTier() {},
};
await tierLocked.setTier("budgeted");
await assert.rejects(tierLocked.setTier("balanced"), /locked to "budgeted"/);
await tierLocked.setMechanism("diffusion");
assert.equal(tierLocked.mechanism, "diffusion", "tier routes must leave mechanism selection mutable");

assert(FROST_LAB_MODES.includes("detail-refraction-offset"));
assert.equal(FROST_QUALITY_TIERS.budgeted.twoScaleRefraction, false);

console.log("webgpu-touch-history-frost route contract passed");
