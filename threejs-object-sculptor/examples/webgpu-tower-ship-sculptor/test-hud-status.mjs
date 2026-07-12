import assert from "node:assert/strict";

import {
  boundedTowerShipReason,
  resolveTowerShipHudState,
  towerShipHudStatus,
  TOWER_SHIP_HUD_STATES,
  TOWER_SHIP_TERMINAL_HUD_STATES,
} from "./hud-status.js";

assert.equal(towerShipHudStatus("initializing"), "INITIALIZING — NATIVE WEBGPU");
assert.equal(towerShipHudStatus("ready"), "READY — NATIVE WEBGPU");
assert.equal(towerShipHudStatus("failed", new Error("renderer init failed")), "FAILED — renderer init failed");
assert.equal(towerShipHudStatus("device-lost", { reason: "destroyed" }), "DEVICE LOST — destroyed");
assert.equal(boundedTowerShipReason("line one\nline two\tline three"), "line one line two line three");
assert.equal(boundedTowerShipReason("x".repeat(120)).length, 96, "terminal reasons must remain bounded");
assert.equal(resolveTowerShipHudState("initializing", "ready"), "ready");
assert.equal(resolveTowerShipHudState("ready", "failed"), "failed");
assert.equal(resolveTowerShipHudState("failed", "ready"), "failed", "generic failure must remain terminal");
assert.equal(resolveTowerShipHudState("failed", "device-lost"), "device-lost", "specific device loss may refine a prior failure");
assert.equal(resolveTowerShipHudState("device-lost", "failed"), "device-lost", "device loss must not be overwritten by a later frame error");
assert.throws(() => towerShipHudStatus("starting"), /Unknown Tower Ship HUD state/);
assert.throws(() => resolveTowerShipHudState("ready", "starting"), /Unknown requested/);
assert.deepEqual(Object.keys(TOWER_SHIP_HUD_STATES), ["initializing", "ready"]);
assert.deepEqual(TOWER_SHIP_TERMINAL_HUD_STATES, ["failed", "device-lost"]);

console.log(JSON.stringify({ ok: true, states: ["initializing", "ready", "failed", "device-lost"], terminalStates: TOWER_SHIP_TERMINAL_HUD_STATES, maxReasonLength: 96 }, null, 2));
