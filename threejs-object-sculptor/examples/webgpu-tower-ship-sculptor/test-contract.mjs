import assert from "node:assert/strict";

import {
  createTowerShip,
  summarizeTowerShip,
  TOWER_SHIP_MODES,
  TOWER_SHIP_TIERS,
} from "./tower-ship-factory.js";
import {
  describeTowerShipReadback,
  resolveFrameDeltaSeconds,
  resolveTowerShipDpr,
  towerShipStateChanged,
  TOWER_SHIP_CAMERAS,
  TOWER_SHIP_DPR_CAPS,
  TOWER_SHIP_RENDER_POLICY,
  TOWER_SHIP_SCENARIOS,
  TOWER_SHIP_SEEDS,
} from "./lab-controller.js";

for (const tier of TOWER_SHIP_TIERS) {
  const ship = createTowerShip({ tier, seed: TOWER_SHIP_SEEDS[0] });
  const summary = summarizeTowerShip(ship.root);
  assert.equal(summary.oars, 24, `${tier} must preserve 24 articulated oars`);
  assert(summary.nodes > 70, `${tier} must expose a deep semantic hierarchy`);
  assert(summary.sockets >= 27, `${tier} must expose mast, camera, and per-oar sockets`);
  assert(summary.colliders >= 3, `${tier} must expose simplified collider metadata`);
  assert(ship.runtime.destructionGroups.has("hull-shell"), `${tier} needs hull destruction group`);
  assert(ship.runtime.destructionGroups.has("oar-bank"), `${tier} needs oar destruction group`);
  for (const mode of TOWER_SHIP_MODES) ship.setMode(mode);
  ship.setTime(1, true);
  ship.root.updateMatrixWorld(true);
  const firstOar = ship.runtime.oars[0];
  const socket = ship.runtime.sockets.get(`${firstOar.name}-socket`);
  assert(socket, `${tier} first oar needs a root socket`);
  assert.equal(socket.parent, firstOar, `${tier} oar socket must stay parent-local`);
  ship.dispose();
}

assert.deepEqual(TOWER_SHIP_CAMERAS, ["design", "profile", "bow", "close-material"]);
assert.deepEqual(TOWER_SHIP_SCENARIOS, {
  "reference-reconstruction": "final",
  "staged-sculpt": "blockout",
  "action-ready": "interaction",
});
assert.equal(resolveTowerShipDpr("full", 3), TOWER_SHIP_DPR_CAPS.full);
assert.equal(resolveTowerShipDpr("budgeted", 3), TOWER_SHIP_DPR_CAPS.budgeted);
assert.equal(resolveTowerShipDpr("minimum", 3), TOWER_SHIP_DPR_CAPS.minimum);
assert.equal(TOWER_SHIP_RENDER_POLICY.trackTimestamp, false, "the live loop must not allocate unconsumed timestamp queries");
assert.equal(resolveFrameDeltaSeconds(99, 100), 0, "initial frame timestamps may precede performance.now() slightly");
assert.equal(resolveFrameDeltaSeconds(116, 100), 0.016);
assert.equal(resolveFrameDeltaSeconds(400, 100), 0.1, "long frame deltas must be capped");
assert.throws(() => resolveFrameDeltaSeconds(Number.NaN, 100), /frame timestamps must be finite/);
assert.equal(towerShipStateChanged("full", "full", TOWER_SHIP_TIERS, "tier"), false, "same-tier route replay must not rebuild");
assert.equal(towerShipStateChanged("full", "minimum", TOWER_SHIP_TIERS, "tier"), true, "changed tier must rebuild");
assert.equal(towerShipStateChanged(1, 1, TOWER_SHIP_SEEDS, "seed"), false, "same-seed route replay must not rebuild");
assert.throws(() => towerShipStateChanged("full", "unknown", TOWER_SHIP_TIERS, "tier"), /Unknown tier/);
assert.deepEqual(describeTowerShipReadback(641, 359, "srgb"), {
  width: 641,
  height: 359,
  format: "rgba8unorm",
  bytesPerPixel: 4,
  rowBytes: 2564,
  bytesPerRow: 2816,
  colorManaged: true,
  outputColorSpace: "srgb",
}, "odd-width capture metadata must preserve the aligned GPU stride and explicit sRGB output contract");
assert.throws(() => describeTowerShipReadback(0, 359, "srgb"), /capture dimensions/);
assert.throws(() => describeTowerShipReadback(641, 359, ""), /output color space/);
assert.throws(() => createTowerShip({ tier: "unknown" }), /Unknown tier/);

console.log(JSON.stringify({ ok: true, tiers: TOWER_SHIP_TIERS, modes: TOWER_SHIP_MODES, cameras: TOWER_SHIP_CAMERAS }, null, 2));
