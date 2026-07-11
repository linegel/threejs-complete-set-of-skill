import assert from "node:assert/strict";

import { createTowerShip, summarizeTowerShip } from "./tower-ship-factory.js";

const ship = createTowerShip({ tier: "full", seed: 1 });
const baseline = summarizeTowerShip(ship.root);
assert.equal(baseline.oars, 24);

const removed = ship.runtime.oars.pop();
assert.equal(ship.runtime.oars.length, 23, "negative control must remove one runtime oar");
assert.notEqual(ship.runtime.oars.length, baseline.oars, "oar-count mutation must be observable");
ship.runtime.oars.push(removed);
assert.equal(ship.runtime.oars.length, 24, "negative control must restore the runtime contract");

const first = ship.runtime.oars[0];
const socket = ship.runtime.sockets.get(`${first.name}-socket`);
first.remove(socket);
assert.notEqual(socket.parent, first, "attachment mutation must break the parent-local socket contract");
first.add(socket);
assert.equal(socket.parent, first, "attachment mutation must be reversible for test isolation");

ship.dispose();
console.log(JSON.stringify({ ok: true, negativeControls: ["oar-count", "socket-parent"] }, null, 2));

