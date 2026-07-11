import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createTowerShip, summarizeTowerShip } from "./tower-ship-factory.js";
import { validateTowerShipActionReady } from "./validate-action-ready.mjs";

const sculptSpec = JSON.parse(readFileSync(new URL("./object-sculpt-spec.json", import.meta.url), "utf8"));

const ship = createTowerShip({ tier: "full", seed: 1 });
const baseline = summarizeTowerShip(ship.root);
assert.equal(baseline.oars, 24);
validateTowerShipActionReady(sculptSpec, ship.root);

const removed = ship.runtime.oars.pop();
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /oar runtime count is 23/, "the production validator must reject an incomplete oar bank");
ship.runtime.oars.push(removed);
validateTowerShipActionReady(sculptSpec, ship.root);

const first = ship.runtime.oars[0];
const socket = ship.runtime.sockets.get(`${first.name}-socket`);
first.remove(socket);
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /is not parent-local/, "the production validator must reject a detached oar socket");
first.add(socket);
validateTowerShipActionReady(sculptSpec, ship.root);

const mastStep = ship.runtime.sockets.get("mast-step");
ship.runtime.sockets.delete("mast-step");
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /attachment socket mast-step/, "the production validator must reject a missing declared attachment socket");
ship.runtime.sockets.set("mast-step", mastStep);
validateTowerShipActionReady(sculptSpec, ship.root);

const hullProxy = ship.runtime.colliders.get("hull-compound");
ship.runtime.colliders.set("hull-compound", {
  ...hullProxy,
  colliderId: { ...hullProxy.colliderId, generation: 0 },
});
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /generation must be a positive integer/, "the production validator must reject a stale collider generation");
ship.runtime.colliders.set("hull-compound", hullProxy);

const towerProxy = ship.runtime.colliders.get("tower-box");
ship.runtime.colliders.set("tower-box", {
  ...towerProxy,
  shape: { ...towerProxy.shape, sizeWorldUnits: [6.6, Number.NaN, 4.2] },
});
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /sizeWorldUnits must contain 3 finite values/, "the production validator must reject nonfinite authoring dimensions");
ship.runtime.colliders.set("tower-box", towerProxy);

const lowerRoof = ship.runtime.destructionGroups.get("lower-roof");
ship.runtime.destructionGroups.delete("lower-roof");
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /destruction group lower-roof/, "the production validator must reject a missing destruction group");
ship.runtime.destructionGroups.set("lower-roof", lowerRoof);
validateTowerShipActionReady(sculptSpec, ship.root);

ship.dispose();
console.log(JSON.stringify({ ok: true, negativeControls: ["oar-count", "socket-parent", "missing-attachment-socket", "collider-generation", "collider-authoring-dimensions", "destruction-group"] }, null, 2));
