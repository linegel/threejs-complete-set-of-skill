import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  analyzeIndexedSurfaceTopology,
  buildHullGeometry,
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
import { towerShipInitialMode } from "./route-state.js";
import { validateTowerShipActionReady } from "./validate-action-ready.mjs";

const sculptSpec = JSON.parse(readFileSync(new URL("./object-sculpt-spec.json", import.meta.url), "utf8"));
const actionReadyContracts = [];

for (const [stations, radial] of [[17, 12], [13, 10], [9, 8]]) {
  const hull = buildHullGeometry(stations, radial);
  const topology = analyzeIndexedSurfaceTopology(hull);
  assert.equal(hull.getAttribute("position").count, stations * radial + 2, "hull needs one cap-center vertex per terminal ring");
  assert.equal(topology.triangles, (stations - 1) * radial * 2 + radial * 2, "hull triangle count must include both cap fans");
  assert.equal(topology.boundaryEdges, 0, "hull must not expose open terminal-ring edges");
  assert.equal(topology.boundaryLoops, 0, "sealed hull must not expose a declared or undeclared boundary loop");
  assert.equal(topology.openBoundaryChains, 0, "sealed hull must not expose a branched boundary chain");
  assert.equal(topology.undeclaredOpenBoundaryLoops, 0, "Tower Ship declares no hull openings");
  assert.equal(topology.nonManifoldEdges, 0, "hull edges must have exactly two incident triangles");
  assert.equal(topology.inconsistentWindingEdges, 0, "each shared hull edge must be traversed in opposite directions");
  assert.equal(topology.degenerateTriangles, 0, "hull caps must not introduce zero-area triangles");
  assert.equal(topology.zeroAreaTriangles, 0, "hull triangles must retain geometric area even when their indices are distinct");
  assert.equal(topology.duplicateTriangles, 0, "hull must not hide coincident duplicate faces");
  assert(topology.signedVolume > 0, "hull winding must enclose positive outward-oriented volume");
  assert.equal(topology.outwardWinding, true, "hull winding must remain outward");
  assert.equal(topology.closedTwoManifold, true, "hull must be a closed two-manifold indexed surface");
  const normals = hull.getAttribute("normal");
  assert(normals.getX(stations * radial) < -0.99, "bow cap must face outward along -X");
  assert(normals.getX(stations * radial + 1) > 0.99, "stern cap must face outward along +X");
  hull.dispose();
}

for (const tier of TOWER_SHIP_TIERS) {
  const ship = createTowerShip({ tier, seed: TOWER_SHIP_SEEDS[0] });
  const summary = summarizeTowerShip(ship.root);
  assert.equal(summary.oars, 24, `${tier} must preserve 24 articulated oars`);
  assert(summary.nodes > 70, `${tier} must expose a deep semantic hierarchy`);
  assert(summary.sockets >= 32, `${tier} must expose declared attachment, camera, and per-oar sockets`);
  assert.equal(summary.colliders, 36, `${tier} must expose stable component and per-oar collider construction inputs`);
  assert(ship.runtime.destructionGroups.has("hull-shell"), `${tier} needs hull destruction group`);
  assert(ship.runtime.destructionGroups.has("oar-bank"), `${tier} needs oar destruction group`);
  for (const mode of TOWER_SHIP_MODES) ship.setMode(mode);
  ship.setTime(1, true);
  ship.root.updateMatrixWorld(true);
  const firstOar = ship.runtime.oars[0];
  const socket = ship.runtime.sockets.get(`${firstOar.name}-socket`);
  assert(socket, `${tier} first oar needs a root socket`);
  assert.equal(socket.parent, firstOar, `${tier} oar socket must stay parent-local`);
  actionReadyContracts.push(validateTowerShipActionReady(sculptSpec, ship.root));
  ship.dispose();
}

for (const key of ["requiredComponentIds", "declaredSocketIds", "colliderIds", "physicsMaterialIds", "destructionGroupIds", "oarIds"]) {
  for (const contract of actionReadyContracts.slice(1)) {
    assert.deepEqual(contract[key], actionReadyContracts[0][key], `${key} must remain stable across visual tiers`);
  }
}

const stressSeedShip = createTowerShip({ tier: "full", seed: TOWER_SHIP_SEEDS[1] });
const stressSeedContract = validateTowerShipActionReady(sculptSpec, stressSeedShip.root);
for (const key of ["requiredComponentIds", "declaredSocketIds", "colliderIds", "physicsMaterialIds", "destructionGroupIds", "oarIds"]) {
  assert.deepEqual(stressSeedContract[key], actionReadyContracts[0][key], `${key} must remain stable across seeds`);
}
stressSeedShip.dispose();

assert.deepEqual(TOWER_SHIP_CAMERAS, ["design", "profile", "bow", "close-material"]);
assert.deepEqual(TOWER_SHIP_SCENARIOS, {
  "reference-reconstruction": "final",
  "staged-sculpt": "blockout",
  "action-ready": "interaction",
});
assert.equal(towerShipInitialMode({ mechanism: null }), "interaction", "general routes must expose animation without an extra mode selection");
assert.equal(towerShipInitialMode({ mechanism: "final" }), "final", "fixed mechanism routes must remain deterministic");
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
  minimumByteLength: 1010692,
  fullyPaddedByteLength: 1010944,
  colorManaged: true,
  outputColorSpace: "srgb",
}, "odd-width capture metadata must preserve the aligned GPU stride and explicit sRGB output contract");
assert.throws(() => describeTowerShipReadback(0, 359, "srgb"), /capture dimensions/);
assert.throws(() => describeTowerShipReadback(641, 359, ""), /output color space/);
assert.throws(() => createTowerShip({ tier: "unknown" }), /Unknown tier/);

console.log(JSON.stringify({ ok: true, tiers: TOWER_SHIP_TIERS, modes: TOWER_SHIP_MODES, cameras: TOWER_SHIP_CAMERAS }, null, 2));
