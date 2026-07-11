import assert from "node:assert/strict";

import {
  createTowerShip,
  summarizeTowerShip,
  TOWER_SHIP_MODES,
  TOWER_SHIP_TIERS,
} from "./tower-ship-factory.js";
import {
  resolveTowerShipDpr,
  TOWER_SHIP_CAMERAS,
  TOWER_SHIP_DPR_CAPS,
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
assert.throws(() => createTowerShip({ tier: "unknown" }), /Unknown tier/);

console.log(JSON.stringify({ ok: true, tiers: TOWER_SHIP_TIERS, modes: TOWER_SHIP_MODES, cameras: TOWER_SHIP_CAMERAS }, null, 2));
