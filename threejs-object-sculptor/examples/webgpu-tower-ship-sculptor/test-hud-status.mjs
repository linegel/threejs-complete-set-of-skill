import assert from "node:assert/strict";

import {
  boundedTowerShipReason,
  towerShipHudStatus,
  TOWER_SHIP_HUD_STATES,
} from "./hud-status.js";

assert.equal(towerShipHudStatus("initializing"), "INITIALIZING — NATIVE WEBGPU");
assert.equal(towerShipHudStatus("ready"), "READY — NATIVE WEBGPU");
assert.equal(towerShipHudStatus("failed", new Error("renderer init failed")), "FAILED — renderer init failed");
assert.equal(towerShipHudStatus("device-lost", { reason: "destroyed" }), "DEVICE LOST — destroyed");
assert.equal(boundedTowerShipReason("line one\nline two\tline three"), "line one line two line three");
assert.equal(boundedTowerShipReason("x".repeat(120)).length, 96, "terminal reasons must remain bounded");
assert.throws(() => towerShipHudStatus("starting"), /Unknown Tower Ship HUD state/);
assert.deepEqual(Object.keys(TOWER_SHIP_HUD_STATES), ["initializing", "ready"]);

console.log(JSON.stringify({ ok: true, states: ["initializing", "ready", "failed", "device-lost"], maxReasonLength: 96 }, null, 2));
